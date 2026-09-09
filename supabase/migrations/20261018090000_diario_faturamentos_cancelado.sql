-- Diário — cancelar faturamento lançado: a linha vira 'cancelado' (histórico
-- preservado, com quem/quando) e os eventos voltam a pendentes. O título no
-- Sponte é cancelado manualmente pelo diretor.

ALTER TABLE public.diario_faturamentos
  DROP CONSTRAINT IF EXISTS diario_faturamentos_status_check;
ALTER TABLE public.diario_faturamentos
  ADD CONSTRAINT diario_faturamentos_status_check
    CHECK (status IN ('faturando', 'erro', 'lancado', 'cancelado'));

ALTER TABLE public.diario_faturamentos
  ADD COLUMN IF NOT EXISTS cancelado_em timestamptz,
  ADD COLUMN IF NOT EXISTS cancelado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelado_por_nome text NOT NULL DEFAULT '';

-- Linha cancelada não ocupa a vaga de "faturamento em aberto" do aluno.
DROP INDEX IF EXISTS public.diario_faturamentos_aberto_por_aluno_idx;
CREATE UNIQUE INDEX diario_faturamentos_aberto_por_aluno_idx
  ON public.diario_faturamentos (student_id)
  WHERE status NOT IN ('lancado', 'cancelado');
