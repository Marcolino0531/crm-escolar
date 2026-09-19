-- Pedagógico (Secretaria) — Fase 0: fundação estrutural.
--
-- Substitui, a partir do ano letivo de 2027, o uso do Sponte pelos professores
-- (corte limpo, sem migração de histórico). Tudo é isolado por unidade
-- (school_id) e, quando faz sentido, por ano letivo.
--
--   • disciplinas               → grade curricular da unidade (nome + séries em
--                                 que é ministrada).
--   • pedagogico_matriculas_ano → aluno × ano letivo × turma, sincronizado do
--                                 Sponte via GetMatriculas (mesma lógica do
--                                 diario_matriculas_ano). Um aluno rematriculado
--                                 tem linha em 2026 E em 2027.
--   • pedagogico_atribuicoes    → professor (funcionarios) × turma × disciplina
--                                 × ano letivo.
--   • pedagogico_calendario     → calendário letivo da unidade por ano.
--   • funcionarios.auth_user_id → conta de acesso do professor (nullable).
--
-- Controle de acesso (dois caminhos, em OR nas policies de leitura):
--   1. Secretaria: módulo 'pedagogico' (can_view/can_edit) + can_access_school,
--      igual aos outros módulos.
--   2. Professor: NÃO tem o módulo. É reconhecido por
--      funcionarios.auth_user_id = auth.uid() e só lê as linhas cobertas pelas
--      SUAS atribuições (turma/disciplina/ano/unidade). Nunca escreve nestas
--      tabelas (as fases seguintes — notas, frequência — terão as próprias).

-- ─── funcionarios.auth_user_id ──────────────────────────────────────────────
ALTER TABLE public.funcionarios
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE
    REFERENCES auth.users (id) ON DELETE SET NULL;

-- funcionarios.id do professor logado (NULL para quem não é professor).
CREATE OR REPLACE FUNCTION public.professor_funcionario_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.funcionarios
   WHERE auth_user_id = _user_id
     AND data_rescisao IS NULL
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.professor_funcionario_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.professor_funcionario_id(uuid) TO authenticated;

-- O professor lê a PRÓPRIA linha de funcionarios (para o app saber quem ele é).
-- Policies são permissivas: soma-se às policies de RH já existentes.
DROP POLICY IF EXISTS "professor view own funcionario" ON public.funcionarios;
CREATE POLICY "professor view own funcionario" ON public.funcionarios
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- ─── Disciplinas ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.disciplinas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  nome text NOT NULL,
  -- Séries/segmentos em que é ministrada (texto livre, ex.: "1º Ano", "Ensino
  -- Fundamental I"). Lista vazia = todas.
  series text[] NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, nome)
);

-- ─── Aluno × ano letivo × turma (fonte: GetMatriculas do ano) ───────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_matriculas_ano (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  sponte_aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  turma_nome text NOT NULL,
  contrato_sponte_numero text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, sponte_aluno_id, ano_letivo)
);

CREATE INDEX IF NOT EXISTS pedagogico_matriculas_ano_turma_idx
  ON public.pedagogico_matriculas_ano (school_id, ano_letivo, turma_nome, ativo);

-- ─── Professor × turma × disciplina × ano ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_atribuicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  professor_id uuid NOT NULL REFERENCES public.funcionarios (id) ON DELETE CASCADE,
  turma_nome text NOT NULL,
  disciplina_id uuid NOT NULL REFERENCES public.disciplinas (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (professor_id, turma_nome, disciplina_id, ano_letivo)
);

CREATE INDEX IF NOT EXISTS pedagogico_atribuicoes_professor_idx
  ON public.pedagogico_atribuicoes (professor_id, ano_letivo);
CREATE INDEX IF NOT EXISTS pedagogico_atribuicoes_school_ano_idx
  ON public.pedagogico_atribuicoes (school_id, ano_letivo);

-- ─── Calendário letivo ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_calendario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  data date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN (
    'letivo', 'feriado', 'evento', 'inicio_trimestre', 'fim_trimestre'
  )),
  -- 1..3 quando tipo é inicio_trimestre / fim_trimestre.
  trimestre smallint CHECK (trimestre BETWEEN 1 AND 3),
  descricao text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, ano_letivo, data, tipo)
);

CREATE INDEX IF NOT EXISTS pedagogico_calendario_ano_idx
  ON public.pedagogico_calendario (school_id, ano_letivo, data);

-- ─── updated_at ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at ON public.disciplinas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.disciplinas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.pedagogico_matriculas_ano;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pedagogico_matriculas_ano
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.pedagogico_calendario;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pedagogico_calendario
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Funções de acesso ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pedagogico_pode_ver(_user_id uuid, _school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_view_module(_user_id, 'pedagogico'::public.app_module)
     AND public.can_access_school(_user_id, _school_id);
$$;

CREATE OR REPLACE FUNCTION public.pedagogico_pode_editar(_user_id uuid, _school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_edit_module(_user_id, 'pedagogico'::public.app_module)
     AND public.can_access_school(_user_id, _school_id);
$$;

-- Professor logado tem atribuição na turma/ano/unidade?
CREATE OR REPLACE FUNCTION public.professor_leciona_turma(
  _user_id uuid, _school_id uuid, _ano_letivo integer, _turma_nome text
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
  );
$$;

-- Professor logado tem alguma atribuição na unidade/ano?
CREATE OR REPLACE FUNCTION public.professor_leciona_na_unidade(
  _user_id uuid, _school_id uuid, _ano_letivo integer
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
  );
$$;

REVOKE EXECUTE ON FUNCTION public.pedagogico_pode_ver(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pedagogico_pode_editar(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.professor_leciona_turma(uuid, uuid, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.professor_leciona_na_unidade(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedagogico_pode_ver(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pedagogico_pode_editar(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.professor_leciona_turma(uuid, uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.professor_leciona_na_unidade(uuid, uuid, integer) TO authenticated;

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.disciplinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedagogico_matriculas_ano ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedagogico_atribuicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedagogico_calendario ENABLE ROW LEVEL SECURITY;

-- Edição pela secretaria (módulo + unidade) nas tabelas de cadastro.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['disciplinas', 'pedagogico_atribuicoes', 'pedagogico_calendario'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "pedagogico edit %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "pedagogico edit %s" ON public.%I FOR ALL TO authenticated USING (public.pedagogico_pode_editar(auth.uid(), school_id)) WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id))',
      t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "pedagogico view disciplinas" ON public.disciplinas;
CREATE POLICY "pedagogico view disciplinas" ON public.disciplinas
  FOR SELECT TO authenticated
  USING (
    public.pedagogico_pode_ver(auth.uid(), school_id)
    OR EXISTS (
      SELECT 1 FROM public.pedagogico_atribuicoes a
       WHERE a.disciplina_id = disciplinas.id
         AND a.professor_id = public.professor_funcionario_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "pedagogico view matriculas_ano" ON public.pedagogico_matriculas_ano;
CREATE POLICY "pedagogico view matriculas_ano" ON public.pedagogico_matriculas_ano
  FOR SELECT TO authenticated
  USING (
    public.pedagogico_pode_ver(auth.uid(), school_id)
    OR public.professor_leciona_turma(auth.uid(), school_id, ano_letivo, turma_nome)
  );

DROP POLICY IF EXISTS "pedagogico view atribuicoes" ON public.pedagogico_atribuicoes;
CREATE POLICY "pedagogico view atribuicoes" ON public.pedagogico_atribuicoes
  FOR SELECT TO authenticated
  USING (
    public.pedagogico_pode_ver(auth.uid(), school_id)
    OR professor_id = public.professor_funcionario_id(auth.uid())
  );

DROP POLICY IF EXISTS "pedagogico view calendario" ON public.pedagogico_calendario;
CREATE POLICY "pedagogico view calendario" ON public.pedagogico_calendario
  FOR SELECT TO authenticated
  USING (
    public.pedagogico_pode_ver(auth.uid(), school_id)
    OR public.professor_leciona_na_unidade(auth.uid(), school_id, ano_letivo)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.disciplinas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedagogico_atribuicoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedagogico_calendario TO authenticated;
-- Vínculos por ano: escrita só pela sincronização (service role).
GRANT SELECT ON public.pedagogico_matriculas_ano TO authenticated;
GRANT ALL ON public.disciplinas, public.pedagogico_matriculas_ano,
  public.pedagogico_atribuicoes, public.pedagogico_calendario TO service_role;
