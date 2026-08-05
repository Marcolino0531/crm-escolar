-- Planner: a rotina só gera ocorrências a partir do mês de criação (inclusive),
-- nunca retroativas. Se o dia configurado já passou no mês da criação, a
-- primeira ocorrência é a do mês seguinte (não nasce "vencida").
--
-- Guardamos esse marco em recurring_task_defs.start_month (YYYY-MM). A geração
-- de ocorrências e os avisos passam a ignorar qualquer mês anterior a ele.

ALTER TABLE public.recurring_task_defs
  ADD COLUMN IF NOT EXISTS start_month text;

-- Backfill das rotinas já existentes: mês de criação, ou o mês seguinte quando
-- o dia configurado já havia passado no mês da criação.
UPDATE public.recurring_task_defs
SET start_month = CASE
  WHEN EXTRACT(DAY FROM created_at)::int <= day_of_month
    THEN to_char(created_at, 'YYYY-MM')
  ELSE to_char(date_trunc('month', created_at) + interval '1 month', 'YYYY-MM')
END
WHERE start_month IS NULL;

ALTER TABLE public.recurring_task_defs
  ALTER COLUMN start_month SET NOT NULL;

ALTER TABLE public.recurring_task_defs
  DROP CONSTRAINT IF EXISTS recurring_task_defs_start_month_check;
ALTER TABLE public.recurring_task_defs
  ADD CONSTRAINT recurring_task_defs_start_month_check
  CHECK (start_month ~ '^\d{4}-\d{2}$');

-- Recarrega o cache de schema do PostgREST.
NOTIFY pgrst, 'reload schema';
