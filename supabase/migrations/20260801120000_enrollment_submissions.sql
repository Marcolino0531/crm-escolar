-- Auditoria do webhook de matrícula (Google Forms → Sponte).
--
-- Guarda o payload recebido e o retorno de cada etapa (aluno + responsáveis),
-- inclusive das submissões que falharam — é a partir daqui que a secretaria
-- reprocessa uma matrícula ou confere o que o Sponte respondeu.
--
-- O índice único parcial em `submission_id` (só nas linhas com status
-- 'sucesso') garante a idempotência: o reenvio da mesma resposta do formulário
-- não cria um segundo aluno, mas uma submissão que falhou pode ser reenviada.

CREATE TABLE IF NOT EXISTS public.enrollment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text,
  unidade text,
  aluno_nome text,
  aluno_cpf text,
  sponte_aluno_id integer,
  status text NOT NULL CHECK (
    status IN ('sucesso', 'duplicado', 'erro_aluno', 'erro_responsavel')
  ),
  erro text,
  payload jsonb NOT NULL,
  resultado jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS enrollment_submissions_sucesso_idx
  ON public.enrollment_submissions (submission_id)
  WHERE submission_id IS NOT NULL AND status = 'sucesso';

CREATE INDEX IF NOT EXISTS enrollment_submissions_created_idx
  ON public.enrollment_submissions (created_at DESC);

ALTER TABLE public.enrollment_submissions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'enrollment_submissions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.enrollment_submissions', pol.policyname);
  END LOOP;
END $$;

-- Leitura para quem enxerga Admissões; a escrita é exclusiva do webhook
-- (service role, que ignora RLS).
CREATE POLICY "admissoes view enrollment_submissions"
  ON public.enrollment_submissions
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'admissoes'::public.app_module));
