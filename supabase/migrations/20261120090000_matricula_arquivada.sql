-- Arquivamento das submissões do formulário de matrícula (tela Matrículas /
-- e-Formulário). Só aditiva: todas as linhas existentes continuam não
-- arquivadas (arquivada_em nula). Arquivar/desarquivar é feito pelas server
-- functions arquivarMatricula/desarquivarMatricula (somente admin, via
-- service role); nada muda no Sponte, nas cobranças, na turma, nos documentos
-- nem no status. Submissão arquivada deixa de aparecer nas pendências do sino.

ALTER TABLE public.enrollment_submissions
  ADD COLUMN IF NOT EXISTS arquivada_em timestamptz,
  ADD COLUMN IF NOT EXISTS arquivada_por uuid,
  ADD COLUMN IF NOT EXISTS arquivada_por_nome text;

CREATE INDEX IF NOT EXISTS enrollment_submissions_unidade_arquivada_idx
  ON public.enrollment_submissions (unidade, arquivada_em, created_at);
