-- Troca do responsável financeiro feita pelo próprio responsável no portal de
-- rematrícula. Prevalece sobre o ResponsavelFinanceiroID do Sponte para o
-- portal (obrigatoriedade de cadastro) e para o Contrato de Matrícula; o
-- Sponte não é alterado — a secretaria ajusta lá ao efetivar.
CREATE TABLE IF NOT EXISTS public.rematricula_responsavel_financeiro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  responsavel_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rematricula_responsavel_financeiro_aluno_idx
  ON public.rematricula_responsavel_financeiro (unidade, aluno_id);

ALTER TABLE public.rematricula_responsavel_financeiro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rematricula_responsavel_financeiro_select ON public.rematricula_responsavel_financeiro;
CREATE POLICY rematricula_responsavel_financeiro_select ON public.rematricula_responsavel_financeiro
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));
