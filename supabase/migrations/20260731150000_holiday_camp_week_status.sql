-- Status de faturamento da semana da Colônia de Férias, controlado no School Hub.
-- Substitui a inferência a partir do Sponte: a operação marca a semana como
-- faturada (pelo lote ou por acordo manual) e pode reabri-la.

CREATE TABLE IF NOT EXISTS public.holiday_camp_week_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('pendente', 'faturado')),
  origem text NOT NULL CHECK (origem IN ('lote', 'manual', 'reabertura')),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, week_start)
);

CREATE INDEX IF NOT EXISTS holiday_camp_week_status_week_idx
  ON public.holiday_camp_week_status (week_start);

ALTER TABLE public.holiday_camp_week_status ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'holiday_camp_week_status' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.holiday_camp_week_status', pol.policyname);
  END LOOP;
END $$;

-- Leitura para quem enxerga a Colônia (o sininho depende dela); escrita apenas
-- pela server function, que valida o acesso financeiro.
CREATE POLICY "colonia view holiday_camp_week_status"
  ON public.holiday_camp_week_status
  FOR SELECT TO authenticated
  USING (
    public.can_view_module(auth.uid(), 'colonia'::public.app_module)
    OR public.can_view_module(auth.uid(), 'colonia_financeiro'::public.app_module)
  );

-- Semanas que já tinham faturamento registrado nascem marcadas como faturadas.
INSERT INTO public.holiday_camp_week_status (school_id, week_start, week_end, status, origem)
SELECT DISTINCT ON (school_id, week_start) school_id, week_start, week_end, 'faturado', 'lote'
FROM public.holiday_camp_invoices
ORDER BY school_id, week_start, created_at DESC
ON CONFLICT (school_id, week_start) DO NOTHING;

-- A data de vencimento por período deixa de existir: o bloqueio da tela não
-- depende mais de conferência no Sponte.
DROP TABLE IF EXISTS public.holiday_camp_billing_dates;

NOTIFY pgrst, 'reload schema';
