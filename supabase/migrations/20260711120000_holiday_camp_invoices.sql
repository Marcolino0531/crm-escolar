-- Faturamento da Colônia de Férias no Sponte.
--
-- Registra, de forma idempotente, cada faturamento (conta a receber) gerado no
-- Sponte a partir do extrato semanal de um aluno. Serve para PREVENIR DUPLICIDADE
-- (um aluno só pode ser faturado UMA vez por semana) e para o Fechamento Semanal
-- exibir o botão como "Faturado" (desabilitado) após o sucesso.
--
-- A escrita acontece EXCLUSIVAMENTE via server function (service role, que ignora
-- RLS) — por isso não há policy de INSERT/UPDATE/DELETE para usuários comuns. A
-- leitura é liberada a quem possui o nível FINANCEIRO da Colônia
-- ('colonia_financeiro'), pois é uma informação financeira.

CREATE TABLE IF NOT EXISTS public.holiday_camp_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.diario_students (id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  amount numeric(10, 2) NOT NULL,
  due_date date NOT NULL,
  sponte_aluno_id text,
  sponte_conta_receber_id text,
  observacao text,
  invoiced_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, week_start)
);

CREATE INDEX IF NOT EXISTS holiday_camp_invoices_school_idx
  ON public.holiday_camp_invoices (school_id);
CREATE INDEX IF NOT EXISTS holiday_camp_invoices_week_idx
  ON public.holiday_camp_invoices (week_start);

ALTER TABLE public.holiday_camp_invoices ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'holiday_camp_invoices' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.holiday_camp_invoices', pol.policyname);
  END LOOP;
END $$;

-- Somente leitura, restrita ao nível Financeiro da Colônia (admin sempre passa).
CREATE POLICY "colonia_financeiro view holiday_camp_invoices"
  ON public.holiday_camp_invoices
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'colonia_financeiro'::public.app_module));

NOTIFY pgrst, 'reload schema';
