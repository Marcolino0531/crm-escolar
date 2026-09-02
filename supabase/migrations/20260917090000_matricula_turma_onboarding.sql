-- Matrícula automática na turma (Sponte) e Onboarding vindo da matrícula formalizada.

ALTER TABLE public.enrollment_submissions
  ADD COLUMN IF NOT EXISTS ano_letivo integer,
  ADD COLUMN IF NOT EXISTS turno text,
  ADD COLUMN IF NOT EXISTS turma_status text,
  ADD COLUMN IF NOT EXISTS sponte_curso_id integer,
  ADD COLUMN IF NOT EXISTS sponte_turma_id integer,
  ADD COLUMN IF NOT EXISTS turma_nome text,
  ADD COLUMN IF NOT EXISTS sponte_contrato_id integer,
  ADD COLUMN IF NOT EXISTS turma_pendencia text,
  ADD COLUMN IF NOT EXISTS onboarding_id uuid,
  ADD COLUMN IF NOT EXISTS boas_vindas_status text;

ALTER TABLE public.enrollment_submissions
  DROP CONSTRAINT IF EXISTS enrollment_submissions_turma_status_check;

ALTER TABLE public.enrollment_submissions
  ADD CONSTRAINT enrollment_submissions_turma_status_check
  CHECK (turma_status IS NULL OR turma_status IN ('matriculado', 'sem_turma', 'erro'));

ALTER TABLE public.enrollment_submissions
  DROP CONSTRAINT IF EXISTS enrollment_submissions_boas_vindas_status_check;

ALTER TABLE public.enrollment_submissions
  ADD CONSTRAINT enrollment_submissions_boas_vindas_status_check
  CHECK (
    boas_vindas_status IS NULL
    OR boas_vindas_status IN ('enviado', 'sem_email', 'nao_configurado', 'falhou')
  );

CREATE INDEX IF NOT EXISTS enrollment_submissions_turma_status_idx
  ON public.enrollment_submissions (turma_status);

-- O turno das aulas curriculares de quem fica em horário estendido: é o turno
-- da turma em que o aluno é matriculado.
ALTER TABLE public.student_routine
  ADD COLUMN IF NOT EXISTS horario_curricular text;

ALTER TABLE public.student_routine
  DROP CONSTRAINT IF EXISTS student_routine_horario_curricular_check;

ALTER TABLE public.student_routine
  ADD CONSTRAINT student_routine_horario_curricular_check
  CHECK (horario_curricular IS NULL OR horario_curricular IN ('', 'M', 'T'));

-- Onboarding: vínculo com a submissão pública que formalizou a matrícula
-- (idempotente em reprocessamento).
ALTER TABLE public.onboarding
  ADD COLUMN IF NOT EXISTS submission_id text;

-- Índice total (não parcial): o ON CONFLICT (submission_id) do upsert não
-- infere índice com predicado. NULL continua repetível no Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_submission_id_key
  ON public.onboarding (submission_id);
