-- Vínculo aluno × ano letivo × turma do Diário do Aluno.
-- diario_students segue sendo a IDENTIDADE do aluno (uma linha por aluno/unidade,
-- referenciada por QR code, planos, horários e eventos). Esta tabela diz em quais
-- anos letivos o aluno tem contrato vigente no Sponte e com qual turma em cada
-- ano — um aluno já rematriculado aparece em 2026 E em 2027, cada um com a sua
-- turma. A sincronização é sempre por ano específico e só mexe nas linhas
-- daquele ano.

CREATE TABLE IF NOT EXISTS public.diario_matriculas_ano (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.diario_students (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  turma_nome text NOT NULL,
  contrato_sponte_numero text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, ano_letivo)
);

CREATE INDEX IF NOT EXISTS diario_matriculas_ano_ano_ativo_idx
  ON public.diario_matriculas_ano (ano_letivo, ativo);

ALTER TABLE public.diario_matriculas_ano ENABLE ROW LEVEL SECURITY;

-- Escrita só pelo servidor (service role, sincronização). Leitura pela
-- permissão do Diário, igual às demais tabelas do módulo.
DROP POLICY IF EXISTS "diario view diario_matriculas_ano" ON public.diario_matriculas_ano;
CREATE POLICY "diario view diario_matriculas_ano" ON public.diario_matriculas_ano
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'diario'::public.app_module));

GRANT SELECT ON public.diario_matriculas_ano TO authenticated;
GRANT ALL ON public.diario_matriculas_ano TO service_role;
