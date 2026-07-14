-- Corrige o alvo de ON CONFLICT do upsert de alunos do Diário.
--
-- O índice único PARCIAL criado antes (…_sponte_uidx WHERE sponte_aluno_id IS
-- NOT NULL) não pode ser usado como arbitro de INSERT ... ON CONFLICT, o que
-- gerava "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". Trocamos por uma UNIQUE constraint real em
-- (school_id, sponte_aluno_id). Múltiplos NULL continuam permitidos (o Postgres
-- trata NULLs como distintos), então alunos cadastrados manualmente — sem
-- sponte_aluno_id — não conflitam entre si.

DROP INDEX IF EXISTS public.diario_students_sponte_uidx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'diario_students_school_sponte_key'
  ) THEN
    ALTER TABLE public.diario_students
      ADD CONSTRAINT diario_students_school_sponte_key UNIQUE (school_id, sponte_aluno_id);
  END IF;
END $$;
