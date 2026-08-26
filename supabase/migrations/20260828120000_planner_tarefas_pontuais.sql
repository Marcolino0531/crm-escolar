-- Planner: tarefas PONTUAIS (uma única data, sem repetição) ao lado das rotinas.
--
-- Reaproveita recurring_task_defs/recurring_task_completions para herdar RLS,
-- notificações e a marca de "cumprida":
--   • kind = 'rotina'  → comportamento atual (repete todo mês em day_of_month).
--   • kind = 'pontual' → ocorre só em due_date; day_of_month e start_month são
--                        derivados dessa data, e a ocorrência nunca aparece em
--                        outro mês (cumprida ou não).

ALTER TABLE public.recurring_task_defs
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'rotina',
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE public.recurring_task_defs
  DROP CONSTRAINT IF EXISTS recurring_task_defs_kind_check;
ALTER TABLE public.recurring_task_defs
  ADD CONSTRAINT recurring_task_defs_kind_check
  CHECK (kind IN ('rotina', 'pontual'));

-- Pontual exige data; rotina não tem data única.
ALTER TABLE public.recurring_task_defs
  DROP CONSTRAINT IF EXISTS recurring_task_defs_due_date_check;
ALTER TABLE public.recurring_task_defs
  ADD CONSTRAINT recurring_task_defs_due_date_check
  CHECK ((kind = 'pontual' AND due_date IS NOT NULL) OR (kind = 'rotina' AND due_date IS NULL));

NOTIFY pgrst, 'reload schema';
