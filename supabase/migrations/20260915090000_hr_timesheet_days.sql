-- Folha de ponto (RH): batidas dia a dia e sinalização de horário desatualizado.
--
-- Até aqui só o agregado por funcionário/competência era guardado, o que obriga
-- a reimportar o PDF para reconferir qualquer coisa. Esta tabela guarda a
-- entrada e a saída reais de cada dia, permitindo filtrar por período e cruzar
-- competências ao longo do tempo. O PDF continua não sendo armazenado.
CREATE TABLE IF NOT EXISTS public.hr_timesheet_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid NOT NULL REFERENCES public.hr_timesheets (id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.funcionarios (id) ON DELETE SET NULL,
  dia date NOT NULL,
  -- Primeira e última batida do dia ("HH:MM"), vazias em dia sem marcação.
  entrada text NOT NULL DEFAULT '',
  saida text NOT NULL DEFAULT '',
  atraso_min integer NOT NULL DEFAULT 0,
  antecipacao_min integer NOT NULL DEFAULT 0,
  -- 'avaliado' (jornada fechada), 'ignorado' (folga, férias, DSR…) ou
  -- 'inconsistente' (marcação parcial/ímpar).
  situacao text NOT NULL DEFAULT 'avaliado'
);

CREATE INDEX IF NOT EXISTS hr_timesheet_days_timesheet_idx
  ON public.hr_timesheet_days (timesheet_id);
CREATE INDEX IF NOT EXISTS hr_timesheet_days_employee_dia_idx
  ON public.hr_timesheet_days (employee_id, dia);
-- Reprocessar a competência apaga a folha anterior (cascade), então cada dia do
-- funcionário aparece uma única vez por folha.
CREATE UNIQUE INDEX IF NOT EXISTS hr_timesheet_days_folha_funcionario_dia_key
  ON public.hr_timesheet_days (timesheet_id, employee_id, dia);

ALTER TABLE public.hr_timesheet_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr timesheet days select" ON public.hr_timesheet_days;
CREATE POLICY "hr timesheet days select" ON public.hr_timesheet_days
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rh'::public.app_module));

-- Sem policy de escrita: a gravação é da server function (service role), que
-- valida a permissão de edição do RH antes.

-- Horário desatualizado: o funcionário sai dos rankings do mês (comparar com o
-- horário errado só geraria atraso falso) e o horário sugerido pelas batidas
-- fica registrado junto do fechamento.
ALTER TABLE public.hr_timesheet_entries
  ADD COLUMN IF NOT EXISTS horario_desatualizado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entrada_sugerida text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS saida_sugerida text NOT NULL DEFAULT '';
