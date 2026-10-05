-- Rematrícula: Questionário de Saúde por ano letivo.
--
-- A rematrícula grava uma linha por colégio + aluno + ano letivo em
-- matricula_saude (submission_id próprio "rematricula:<unidade>:<aluno>:<ano>"),
-- no mesmo padrão de student_routine. As linhas existentes são do formulário de
-- matrícula ("matricula"). RLS, policies e privilégios da tabela não mudam.

BEGIN;

ALTER TABLE public.matricula_saude
  -- 'matricula' (formulário novo) ou 'rematricula' (atualização anual).
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'matricula',
  -- Ano letivo a que as respostas se referem (usado pela Rematrícula).
  ADD COLUMN IF NOT EXISTS ano_letivo integer;

-- Sugestão inicial do portal: a resposta mais recente do aluno no colégio.
CREATE INDEX IF NOT EXISTS matricula_saude_unidade_aluno_idx
  ON public.matricula_saude (unidade, sponte_aluno_id, updated_at DESC);

COMMIT;

NOTIFY pgrst, 'reload schema';
