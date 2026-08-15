-- Folha de ponto mensal (RH): rankings de atraso e de saída antecipada.
--
-- Fonte de dados própria, independente do ranking de faltas (lançamento manual
-- diário): aqui o insumo é o PDF do relógio de ponto, processado uma vez por
-- competência e por unidade. O PDF NÃO é armazenado — fica só o resultado
-- agregado por funcionário, que é o que alimenta os rankings e o histórico.
CREATE TABLE IF NOT EXISTS public.hr_timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools (id) ON DELETE SET NULL,
  -- Mês de referência da folha, no formato YYYY-MM.
  competencia text NOT NULL,
  arquivo_nome text NOT NULL DEFAULT '',
  -- Layout reconhecido do relatório ('cartao_ponto' ou 'iponto'), para
  -- diagnosticar divergência de leitura quando o fornecedor muda o relatório.
  layout text NOT NULL DEFAULT '',
  -- Minutos de tolerância aplicados no cálculo (0 = qualquer minuto conta).
  tolerancia_min integer NOT NULL DEFAULT 0,
  total_paginas integer NOT NULL DEFAULT 0,
  paginas_processadas integer NOT NULL DEFAULT 0,
  paginas_sem_correspondencia integer NOT NULL DEFAULT 0,
  processado_em timestamptz NOT NULL DEFAULT now(),
  processado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  processado_por_nome text NOT NULL DEFAULT ''
);

-- Uma folha por competência e unidade: reprocessar o mesmo mês substitui o
-- resultado anterior em vez de duplicar o ranking.
CREATE UNIQUE INDEX IF NOT EXISTS hr_timesheets_competencia_school_key
  ON public.hr_timesheets (competencia, school_id) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS public.hr_timesheet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid NOT NULL REFERENCES public.hr_timesheets (id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.funcionarios (id) ON DELETE SET NULL,
  employee_nome text NOT NULL DEFAULT '',
  -- Horário do cadastro usado como referência na comparação, congelado no
  -- processamento: mudar o cadastro depois não reescreve o mês já fechado.
  horario_entrada text NOT NULL DEFAULT '',
  horario_saida text NOT NULL DEFAULT '',
  dias_atraso integer NOT NULL DEFAULT 0,
  minutos_atraso integer NOT NULL DEFAULT 0,
  dias_saida_antecipada integer NOT NULL DEFAULT 0,
  minutos_saida_antecipada integer NOT NULL DEFAULT 0,
  dias_avaliados integer NOT NULL DEFAULT 0,
  dias_inconsistentes integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS hr_timesheet_entries_timesheet_idx
  ON public.hr_timesheet_entries (timesheet_id);
CREATE INDEX IF NOT EXISTS hr_timesheet_entries_employee_idx
  ON public.hr_timesheet_entries (employee_id);

ALTER TABLE public.hr_timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_timesheet_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr timesheets select" ON public.hr_timesheets;
CREATE POLICY "hr timesheets select" ON public.hr_timesheets
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rh'::public.app_module));

DROP POLICY IF EXISTS "hr timesheet entries select" ON public.hr_timesheet_entries;
CREATE POLICY "hr timesheet entries select" ON public.hr_timesheet_entries
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rh'::public.app_module));

-- Sem policy de escrita: o processamento grava pela server function (service
-- role), que valida a permissão de edição do RH antes.
