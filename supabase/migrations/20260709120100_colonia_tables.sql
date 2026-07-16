-- Módulo "Colônia de Férias" — tabela de registros independente.
--
-- A Colônia é um serviço avulso pago por uso: NÃO há plano contratado nem
-- validação de horário. Cada clique num botão (refeição ou portaria) grava uma
-- linha em public.holiday_camp_records com a hora exata do evento (occurred_at),
-- montando o histórico diário individual de cada criança. A precificação/cobrança
-- baseada no consumo do dia será tratada num passo posterior.
--
-- ROSTER: as crianças/turmas continuam vindo da base do Sponte já sincronizada
-- em public.diario_students / public.diario_classes. Para que um usuário com
-- acesso APENAS à Colônia consiga listar as crianças, as policies de SELECT
-- dessas duas tabelas são estendidas para também liberar quem pode ver 'colonia'.
--
-- PERMISSÕES/RLS: leitura exige can_view_module('colonia'); qualquer escrita
-- exige can_edit_module('colonia'). Admin sempre passa. A inserção de registros
-- exige ainda que recorded_by = auth.uid().

-- ─── Enum do domínio (tipos de registro) ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'colonia_record_type') THEN
    CREATE TYPE public.colonia_record_type AS ENUM (
      'breakfast', 'lunch', 'snack', 'dinner', 'entry', 'exit'
    );
  END IF;
END $$;

-- ─── Registros da Colônia de Férias (histórico diário por criança) ───────────
CREATE TABLE IF NOT EXISTS public.holiday_camp_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.diario_students (id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  record_type public.colonia_record_type NOT NULL,
  recorded_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS holiday_camp_records_student_idx
  ON public.holiday_camp_records (student_id);
CREATE INDEX IF NOT EXISTS holiday_camp_records_school_idx
  ON public.holiday_camp_records (school_id);
CREATE INDEX IF NOT EXISTS holiday_camp_records_occurred_idx
  ON public.holiday_camp_records (occurred_at DESC);

ALTER TABLE public.holiday_camp_records ENABLE ROW LEVEL SECURITY;

-- ─── Policies do módulo (idempotentes) ───────────────────────────────────────
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'holiday_camp_records' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.holiday_camp_records', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "colonia view holiday_camp_records" ON public.holiday_camp_records
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'colonia'::public.app_module));

CREATE POLICY "colonia insert holiday_camp_records" ON public.holiday_camp_records
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_edit_module(auth.uid(), 'colonia'::public.app_module)
    AND recorded_by = auth.uid()
  );

CREATE POLICY "colonia update holiday_camp_records" ON public.holiday_camp_records
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'colonia'::public.app_module))
  WITH CHECK (public.can_edit_module(auth.uid(), 'colonia'::public.app_module));

CREATE POLICY "colonia delete holiday_camp_records" ON public.holiday_camp_records
  FOR DELETE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'colonia'::public.app_module));

-- ─── Estende o SELECT do roster (Sponte) para quem vê a Colônia ──────────────
-- Recria a policy de leitura de diario_classes/diario_students permitindo tanto
-- can_view_module('diario') quanto can_view_module('colonia'). As policies de
-- escrita dessas tabelas continuam restritas ao módulo Diário.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['diario_classes', 'diario_students'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "diario view %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "diario/colonia view %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "diario/colonia view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''diario''::public.app_module) OR public.can_view_module(auth.uid(), ''colonia''::public.app_module))',
      t, t);
  END LOOP;
END $$;
