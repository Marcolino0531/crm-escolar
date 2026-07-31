-- Data de vencimento do faturamento da Colônia de Férias, por semana e unidade.
--
-- O Fechamento Semanal usa essa data para faturar no Sponte e, principalmente,
-- para conferir se o aluno JÁ possui título de Colônia naquele vencimento
-- (independente do status do boleto). Sem persistência, um F5 devolvia o input
-- ao padrão e a conferência rodava com a data errada, reabrindo indevidamente o
-- botão "Faturar Todos no Sponte".
--
-- A escrita acontece EXCLUSIVAMENTE via server function (service role, que
-- ignora RLS) — por isso não há policy de INSERT/UPDATE/DELETE. A leitura é
-- liberada a quem possui o nível FINANCEIRO da Colônia.

CREATE TABLE IF NOT EXISTS public.holiday_camp_billing_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  due_date date NOT NULL,
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, week_start)
);

CREATE INDEX IF NOT EXISTS holiday_camp_billing_dates_week_idx
  ON public.holiday_camp_billing_dates (week_start);

ALTER TABLE public.holiday_camp_billing_dates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'holiday_camp_billing_dates' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.holiday_camp_billing_dates', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "colonia_financeiro view holiday_camp_billing_dates"
  ON public.holiday_camp_billing_dates
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'colonia_financeiro'::public.app_module));

-- Backfill: semanas já faturadas herdam o vencimento do próprio faturamento,
-- para que o Fechamento nasça com a data certa sem redigitação.
INSERT INTO public.holiday_camp_billing_dates (school_id, week_start, week_end, due_date)
SELECT DISTINCT ON (school_id, week_start) school_id, week_start, week_end, due_date
FROM public.holiday_camp_invoices
ORDER BY school_id, week_start, created_at DESC
ON CONFLICT (school_id, week_start) DO NOTHING;

NOTIFY pgrst, 'reload schema';
