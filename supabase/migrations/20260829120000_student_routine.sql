-- Rotina Escolar coletada na etapa 2 do formulário nativo de matrícula
-- (/matricula): data de início, dias/horários de entrada e saída e a grade de
-- refeições contratadas.
--
-- Estes dados NÃO vão ao Sponte (a API não tem campo para eles) e ficam aqui
-- até a integração com o Diário do Aluno ser definida — o formato espelha
-- diario_schedules (weekday + entry/exit) e diario_meal_plans (meal × weekday)
-- justamente para essa migração ser direta.
--
-- Idempotência: `submission_id` é único, então o reenvio da mesma submissão
-- atualiza a linha em vez de duplicar a rotina.

CREATE TABLE IF NOT EXISTS public.student_routine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text NOT NULL UNIQUE,
  unidade text NOT NULL,
  -- AlunoID devolvido pelo Sponte na criação (vínculo com o aluno matriculado).
  sponte_aluno_id integer,
  aluno_nome text NOT NULL,
  data_inicio date NOT NULL,
  -- 1=segunda … 5=sexta (Date.getDay(), como no Diário do Aluno).
  dias_ativos smallint[] NOT NULL,
  -- [{ "weekday": 1, "entrada": "07:20", "saida": "11:50" }, …]
  horarios jsonb NOT NULL,
  sem_refeicoes boolean NOT NULL DEFAULT false,
  -- { "breakfast": [1,2], "lunch": [], "snack": [], "dinner": [] }
  refeicoes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_routine_aluno_idx
  ON public.student_routine (sponte_aluno_id)
  WHERE sponte_aluno_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS student_routine_created_idx
  ON public.student_routine (created_at DESC);

DROP TRIGGER IF EXISTS student_routine_set_updated_at ON public.student_routine;
CREATE TRIGGER student_routine_set_updated_at BEFORE UPDATE ON public.student_routine
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.student_routine ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_routine'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.student_routine', pol.policyname);
  END LOOP;
END $$;

-- Leitura para quem enxerga Admissões (mesma regra do painel /matriculas); a
-- escrita é exclusiva do formulário público (service role, que ignora RLS).
CREATE POLICY "admissoes view student_routine"
  ON public.student_routine
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'admissoes'::public.app_module));

NOTIFY pgrst, 'reload schema';
