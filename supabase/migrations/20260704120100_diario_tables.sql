-- Módulo "Diário do Aluno" — estruturas de dados (espelho do modelo do
-- School Connect, adaptado ao School Hub).
--
-- Relacionamentos: unidade (public.schools) → turma (diario_classes) →
-- aluno (diario_students). Cada aluno tem um plano de refeições contratadas
-- por dia da semana (diario_meal_plans) e um horário de entrada/saída por dia
-- (diario_schedules). Todo registro do dia a dia (refeição servida ou
-- entrada/saída) vira uma linha em diario_events, com a flag extra_charge
-- marcando consumo/uso fora do que foi contratado (gera cobrança extra).
--
-- MULTIUNIDADE: em vez de recriar a tabela `units` do projeto original,
-- reaproveitamos public.schools (as unidades já existentes do School Hub), de
-- modo que o Diário respeite o seletor global de unidade do cabeçalho.
--
-- PERMISSÕES/RLS: leitura exige can_view_module('diario'); qualquer escrita
-- exige can_edit_module('diario'). Admin sempre passa. Os registros de eventos
-- (diario_events) exigem, além da edição, que recorded_by = auth.uid().

-- ─── Enums do domínio ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diario_meal_key') THEN
    CREATE TYPE public.diario_meal_key AS ENUM ('breakfast', 'lunch', 'snack', 'dinner');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diario_event_type') THEN
    CREATE TYPE public.diario_event_type AS ENUM ('meal', 'checkinout');
  END IF;
END $$;

-- ─── Turmas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diario_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE INDEX IF NOT EXISTS diario_classes_school_idx ON public.diario_classes (school_id);

DROP TRIGGER IF EXISTS diario_classes_set_updated_at ON public.diario_classes;
CREATE TRIGGER diario_classes_set_updated_at BEFORE UPDATE ON public.diario_classes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.diario_classes ENABLE ROW LEVEL SECURITY;

-- ─── Alunos ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diario_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.diario_classes (id) ON DELETE SET NULL,
  -- Nome da turma desnormalizado (mantido em sincronia por trigger) para
  -- listagem/agrupamento sem join.
  class_name text NOT NULL DEFAULT '',
  name text NOT NULL,
  photo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diario_students_school_idx ON public.diario_students (school_id);
CREATE INDEX IF NOT EXISTS diario_students_class_idx ON public.diario_students (class_id);

DROP TRIGGER IF EXISTS diario_students_set_updated_at ON public.diario_students;
CREATE TRIGGER diario_students_set_updated_at BEFORE UPDATE ON public.diario_students
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.diario_students ENABLE ROW LEVEL SECURITY;

-- ─── Plano de refeições contratadas (1 linha por aluno/refeição/dia) ──────────
CREATE TABLE IF NOT EXISTS public.diario_meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.diario_students (id) ON DELETE CASCADE,
  meal public.diario_meal_key NOT NULL,
  -- 0=domingo … 6=sábado (Date.getDay()).
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  UNIQUE (student_id, meal, weekday)
);

CREATE INDEX IF NOT EXISTS diario_meal_plans_student_idx ON public.diario_meal_plans (student_id);

ALTER TABLE public.diario_meal_plans ENABLE ROW LEVEL SECURITY;

-- ─── Horário contratado (1 linha por aluno/dia) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.diario_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.diario_students (id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  entry text NOT NULL, -- "HH:MM"
  exit text NOT NULL,  -- "HH:MM"
  UNIQUE (student_id, weekday)
);

CREATE INDEX IF NOT EXISTS diario_schedules_student_idx ON public.diario_schedules (student_id);

ALTER TABLE public.diario_schedules ENABLE ROW LEVEL SECURITY;

-- ─── Eventos (registros do dia a dia) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diario_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.diario_students (id) ON DELETE CASCADE,
  recorded_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  event_type public.diario_event_type NOT NULL,
  meal public.diario_meal_key,
  label text NOT NULL,
  -- Consumo extra: refeição/horário fora do que foi contratado pela família.
  extra_charge boolean NOT NULL DEFAULT false,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diario_events_student_idx ON public.diario_events (student_id);
CREATE INDEX IF NOT EXISTS diario_events_created_idx ON public.diario_events (created_at DESC);
CREATE INDEX IF NOT EXISTS diario_events_extra_idx ON public.diario_events (extra_charge) WHERE extra_charge = true;

ALTER TABLE public.diario_events ENABLE ROW LEVEL SECURITY;

-- ─── Sincronização turma → aluno (nome e unidade) ────────────────────────────
-- Ao definir/alterar class_id de um aluno, herdar class_name e school_id da turma.
CREATE OR REPLACE FUNCTION public.diario_sync_student_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.class_id IS NOT NULL THEN
    SELECT c.name, c.school_id INTO NEW.class_name, NEW.school_id
    FROM public.diario_classes c
    WHERE c.id = NEW.class_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diario_students_sync_class ON public.diario_students;
CREATE TRIGGER diario_students_sync_class
  BEFORE INSERT OR UPDATE OF class_id ON public.diario_students
  FOR EACH ROW EXECUTE FUNCTION public.diario_sync_student_class();

-- Ao renomear/mover uma turma, propagar para os alunos vinculados.
CREATE OR REPLACE FUNCTION public.diario_propagate_class_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.name <> OLD.name OR NEW.school_id <> OLD.school_id THEN
    UPDATE public.diario_students
    SET class_name = NEW.name, school_id = NEW.school_id
    WHERE class_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diario_classes_propagate ON public.diario_classes;
CREATE TRIGGER diario_classes_propagate
  AFTER UPDATE ON public.diario_classes
  FOR EACH ROW EXECUTE FUNCTION public.diario_propagate_class_change();

-- ─── Policies (idempotentes) ─────────────────────────────────────────────────
-- Tabelas cujo acesso segue diretamente a permissão do módulo.
DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY['diario_classes', 'diario_students', 'diario_meal_plans', 'diario_schedules'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "diario view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''diario''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "diario insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), ''diario''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "diario update %s" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), ''diario''::public.app_module)) WITH CHECK (public.can_edit_module(auth.uid(), ''diario''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "diario delete %s" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), ''diario''::public.app_module))',
      t, t);
  END LOOP;
END $$;

-- diario_events: leitura pela permissão do módulo; inserção exige edição E que o
-- registro seja atribuído ao próprio usuário (recorded_by = auth.uid()).
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'diario_events' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.diario_events', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "diario view diario_events" ON public.diario_events
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'diario'::public.app_module));

CREATE POLICY "diario insert diario_events" ON public.diario_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_edit_module(auth.uid(), 'diario'::public.app_module)
    AND recorded_by = auth.uid()
  );

CREATE POLICY "diario update diario_events" ON public.diario_events
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'diario'::public.app_module))
  WITH CHECK (public.can_edit_module(auth.uid(), 'diario'::public.app_module));

CREATE POLICY "diario delete diario_events" ON public.diario_events
  FOR DELETE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'diario'::public.app_module));
