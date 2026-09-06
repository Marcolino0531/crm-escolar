-- Anualização do Diário do Aluno.
--
-- Plano de refeições e horário de entrada/saída passam a ser por ano letivo:
-- a rotina preenchida na rematrícula (ano seguinte) não pode sobrescrever a
-- do ano em uso. O "ano vigente" (o que o Diário carrega por padrão e o que o
-- registro diário usa) fica em rematricula_config.ano_vigente, separado do
-- ano_letivo da rematrícula em andamento. A troca de ano é administrativa.

ALTER TABLE public.rematricula_config
  ADD COLUMN IF NOT EXISTS ano_vigente integer
    NOT NULL DEFAULT EXTRACT(YEAR FROM now())::integer
    CHECK (ano_vigente BETWEEN 2024 AND 2100);

-- ── diario_meal_plans ────────────────────────────────────────────────────────
ALTER TABLE public.diario_meal_plans ADD COLUMN IF NOT EXISTS ano_letivo integer;

UPDATE public.diario_meal_plans
SET ano_letivo = COALESCE(
  (SELECT ano_vigente FROM public.rematricula_config WHERE id = true),
  EXTRACT(YEAR FROM now())::integer
)
WHERE ano_letivo IS NULL;

ALTER TABLE public.diario_meal_plans
  ALTER COLUMN ano_letivo SET NOT NULL,
  ADD CONSTRAINT diario_meal_plans_ano_letivo_check CHECK (ano_letivo BETWEEN 2024 AND 2100);

ALTER TABLE public.diario_meal_plans
  DROP CONSTRAINT IF EXISTS diario_meal_plans_student_id_meal_weekday_key;
ALTER TABLE public.diario_meal_plans
  ADD CONSTRAINT diario_meal_plans_student_meal_weekday_ano_key
  UNIQUE (student_id, meal, weekday, ano_letivo);

CREATE INDEX IF NOT EXISTS diario_meal_plans_student_ano_idx
  ON public.diario_meal_plans (student_id, ano_letivo);
CREATE INDEX IF NOT EXISTS diario_meal_plans_ano_idx
  ON public.diario_meal_plans (ano_letivo);

-- ── diario_schedules ─────────────────────────────────────────────────────────
ALTER TABLE public.diario_schedules ADD COLUMN IF NOT EXISTS ano_letivo integer;

UPDATE public.diario_schedules
SET ano_letivo = COALESCE(
  (SELECT ano_vigente FROM public.rematricula_config WHERE id = true),
  EXTRACT(YEAR FROM now())::integer
)
WHERE ano_letivo IS NULL;

ALTER TABLE public.diario_schedules
  ALTER COLUMN ano_letivo SET NOT NULL,
  ADD CONSTRAINT diario_schedules_ano_letivo_check CHECK (ano_letivo BETWEEN 2024 AND 2100);

ALTER TABLE public.diario_schedules
  DROP CONSTRAINT IF EXISTS diario_schedules_student_id_weekday_key;
ALTER TABLE public.diario_schedules
  ADD CONSTRAINT diario_schedules_student_weekday_ano_key
  UNIQUE (student_id, weekday, ano_letivo);

CREATE INDEX IF NOT EXISTS diario_schedules_student_ano_idx
  ON public.diario_schedules (student_id, ano_letivo);
CREATE INDEX IF NOT EXISTS diario_schedules_ano_idx
  ON public.diario_schedules (ano_letivo);
