-- Pedagógico (Secretaria) — Fase 1: diário de classe do dia a dia.
--
--   • pedagogico_horarios    → grade semanal da turma (dia da semana + horário
--                              + disciplina), cadastrada pela secretaria.
--   • pedagogico_conteudos   → conteúdo ministrado (e lição de casa) em uma
--                              aula: turma × disciplina × data.
--   • pedagogico_frequencia  → presença/falta por aluno na mesma aula
--                              (turma × disciplina × data); aluno pelo
--                              sponte_aluno_id, igual a pedagogico_matriculas_ano.
--
-- Acesso (mesmo modelo da Fase 0, em OR):
--   1. Secretaria: módulo 'pedagogico' (pedagogico_pode_ver / pode_editar).
--   2. Professor: identificado por funcionarios.auth_user_id = auth.uid().
--      Lê a grade das turmas onde leciona; lança/edita conteúdo e frequência
--      SOMENTE em turma+disciplina da própria atribuição no ano/unidade
--      (professor_leciona_disciplina) e com professor_id igual ao seu.
--
-- Infantil não tem tratamento especial: uma disciplina única cobrindo o
-- período já resolve com a mesma estrutura turma+disciplina+data.

-- ─── Professor tem atribuição na turma+disciplina? ──────────────────────────
CREATE OR REPLACE FUNCTION public.professor_leciona_disciplina(
  _user_id uuid, _school_id uuid, _ano_letivo integer, _turma_nome text, _disciplina_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pedagogico_atribuicoes a
     WHERE a.professor_id = public.professor_funcionario_id(_user_id)
       AND a.school_id = _school_id
       AND a.ano_letivo = _ano_letivo
       AND a.turma_nome = _turma_nome
       AND a.disciplina_id = _disciplina_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.professor_leciona_disciplina(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.professor_leciona_disciplina(uuid, uuid, integer, text, uuid) TO authenticated;

-- ─── Grade de horários ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_horarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  turma_nome text NOT NULL,
  disciplina_id uuid NOT NULL REFERENCES public.disciplinas (id) ON DELETE CASCADE,
  -- ISO: 1 = segunda … 7 = domingo.
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  horario_inicio time NOT NULL,
  horario_fim time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pedagogico_horarios_intervalo CHECK (horario_fim > horario_inicio),
  UNIQUE (school_id, ano_letivo, turma_nome, dia_semana, horario_inicio)
);

CREATE INDEX IF NOT EXISTS pedagogico_horarios_turma_idx
  ON public.pedagogico_horarios (school_id, ano_letivo, turma_nome, dia_semana);

-- ─── Conteúdo ministrado ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_conteudos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  turma_nome text NOT NULL,
  disciplina_id uuid NOT NULL REFERENCES public.disciplinas (id) ON DELETE CASCADE,
  professor_id uuid NOT NULL REFERENCES public.funcionarios (id) ON DELETE RESTRICT,
  data date NOT NULL,
  conteudo text NOT NULL,
  licao_casa text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Uma aula (turma × disciplina × data) tem um único registro de conteúdo.
  UNIQUE (school_id, ano_letivo, turma_nome, disciplina_id, data)
);

CREATE INDEX IF NOT EXISTS pedagogico_conteudos_turma_data_idx
  ON public.pedagogico_conteudos (school_id, ano_letivo, turma_nome, data);
CREATE INDEX IF NOT EXISTS pedagogico_conteudos_professor_idx
  ON public.pedagogico_conteudos (professor_id, data);

-- ─── Frequência por aula ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_frequencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  turma_nome text NOT NULL,
  disciplina_id uuid NOT NULL REFERENCES public.disciplinas (id) ON DELETE CASCADE,
  professor_id uuid NOT NULL REFERENCES public.funcionarios (id) ON DELETE RESTRICT,
  data date NOT NULL,
  -- Mesmo identificador de pedagogico_matriculas_ano (AlunoID do Sponte).
  sponte_aluno_id text NOT NULL,
  presente boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, ano_letivo, turma_nome, disciplina_id, data, sponte_aluno_id)
);

CREATE INDEX IF NOT EXISTS pedagogico_frequencia_aula_idx
  ON public.pedagogico_frequencia (school_id, ano_letivo, turma_nome, disciplina_id, data);
CREATE INDEX IF NOT EXISTS pedagogico_frequencia_aluno_idx
  ON public.pedagogico_frequencia (school_id, ano_letivo, sponte_aluno_id);

-- ─── updated_at ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at ON public.pedagogico_horarios;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pedagogico_horarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.pedagogico_conteudos;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pedagogico_conteudos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.pedagogico_frequencia;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pedagogico_frequencia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.pedagogico_horarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedagogico_conteudos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedagogico_frequencia ENABLE ROW LEVEL SECURITY;

-- Grade: secretaria edita; professor lê a grade das turmas onde leciona.
DROP POLICY IF EXISTS "pedagogico edit horarios" ON public.pedagogico_horarios;
CREATE POLICY "pedagogico edit horarios" ON public.pedagogico_horarios
  FOR ALL TO authenticated
  USING (public.pedagogico_pode_editar(auth.uid(), school_id))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id));

DROP POLICY IF EXISTS "pedagogico view horarios" ON public.pedagogico_horarios;
CREATE POLICY "pedagogico view horarios" ON public.pedagogico_horarios
  FOR SELECT TO authenticated
  USING (
    public.pedagogico_pode_ver(auth.uid(), school_id)
    OR public.professor_leciona_turma(auth.uid(), school_id, ano_letivo, turma_nome)
  );

-- Conteúdo e frequência: secretaria vê/edita tudo da unidade; professor só a
-- própria atribuição (turma+disciplina) e só com professor_id = ele mesmo.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pedagogico_conteudos', 'pedagogico_frequencia'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "pedagogico edit %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "pedagogico edit %s" ON public.%I FOR ALL TO authenticated USING (public.pedagogico_pode_editar(auth.uid(), school_id)) WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id))',
      t, t);

    EXECUTE format('DROP POLICY IF EXISTS "pedagogico view %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "pedagogico view %s" ON public.%I FOR SELECT TO authenticated USING (public.pedagogico_pode_ver(auth.uid(), school_id) OR public.professor_leciona_disciplina(auth.uid(), school_id, ano_letivo, turma_nome, disciplina_id))',
      t, t);

    EXECUTE format('DROP POLICY IF EXISTS "professor lanca %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "professor lanca %s" ON public.%I FOR ALL TO authenticated USING (professor_id = public.professor_funcionario_id(auth.uid()) AND public.professor_leciona_disciplina(auth.uid(), school_id, ano_letivo, turma_nome, disciplina_id)) WITH CHECK (professor_id = public.professor_funcionario_id(auth.uid()) AND public.professor_leciona_disciplina(auth.uid(), school_id, ano_letivo, turma_nome, disciplina_id))',
      t, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedagogico_horarios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedagogico_conteudos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedagogico_frequencia TO authenticated;
GRANT ALL ON public.pedagogico_horarios, public.pedagogico_conteudos,
  public.pedagogico_frequencia TO service_role;
