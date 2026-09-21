-- Pedagógico (Secretaria) — Fase 2: avaliações e notas (Fundamental em diante)
-- e parecer descritivo (Infantil).
--
--   • pedagogico_atividades_avaliativas → prova/trabalho de uma turma × disciplina
--       × trimestre com valor máximo; a soma dos valores do trimestre não passa
--       de 30 / 30 / 40 (trigger).
--   • pedagogico_notas                  → nota do aluno em uma atividade.
--   • pedagogico_recuperacoes_trimestre → recuperação do 1º/2º trimestre (vale 30).
--   • pedagogico_recuperacoes_finais    → recuperação final (vale 100), lançada
--       pela secretaria quando a soma anual < 70.
--   • pedagogico_pareceres              → parecer descritivo do Infantil por
--       aluno × trimestre (sem nota).
--
-- Aluno sempre pelo sponte_aluno_id (mesmo padrão de pedagogico_matriculas_ano).
-- As fórmulas (teto 21 na recuperação, trava 70 na final) ficam no app
-- (src/lib/pedagogico-notas.ts); o banco guarda só os lançamentos.
--
-- Acesso (mesmo modelo das Fases 0/1, em OR):
--   1. Secretaria: módulo 'pedagogico' (pedagogico_pode_ver / pode_editar).
--   2. Professor: professor_leciona_disciplina(turma+disciplina) para
--      atividades, notas (via a atividade) e recuperações de trimestre;
--      professor_leciona_turma para pareceres (Infantil pode não ter disciplina).
--      Recuperação final é só da secretaria (professor lê).

-- ─── Atividades avaliativas ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_atividades_avaliativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  turma_nome text NOT NULL,
  disciplina_id uuid NOT NULL REFERENCES public.disciplinas (id) ON DELETE CASCADE,
  professor_id uuid NOT NULL REFERENCES public.funcionarios (id) ON DELETE RESTRICT,
  trimestre smallint NOT NULL CHECK (trimestre BETWEEN 1 AND 3),
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  valor_maximo numeric(6,2) NOT NULL CHECK (valor_maximo > 0),
  data date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pedagogico_atividades_turma_idx
  ON public.pedagogico_atividades_avaliativas (school_id, ano_letivo, turma_nome, disciplina_id, trimestre);

-- Soma dos valores do trimestre ≤ total (30/30/40). Lock por chave para duas
-- inserções simultâneas não furarem o teto.
CREATE OR REPLACE FUNCTION public.pedagogico_valor_trimestre(_trimestre smallint)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE _trimestre WHEN 1 THEN 30 WHEN 2 THEN 30 WHEN 3 THEN 40 END::numeric $$;

CREATE OR REPLACE FUNCTION public.pedagogico_checar_soma_atividades()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  soma numeric;
  teto numeric := public.pedagogico_valor_trimestre(NEW.trimestre);
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(NEW.school_id::text || '|' || NEW.ano_letivo || '|' || NEW.turma_nome || '|' ||
             NEW.disciplina_id::text || '|' || NEW.trimestre));
  SELECT COALESCE(SUM(valor_maximo), 0) INTO soma
    FROM public.pedagogico_atividades_avaliativas a
   WHERE a.school_id = NEW.school_id AND a.ano_letivo = NEW.ano_letivo
     AND a.turma_nome = NEW.turma_nome AND a.disciplina_id = NEW.disciplina_id
     AND a.trimestre = NEW.trimestre AND a.id <> NEW.id;
  IF soma + NEW.valor_maximo > teto THEN
    RAISE EXCEPTION 'A soma das atividades do %º trimestre (%) ultrapassa o máximo de % pontos.',
      NEW.trimestre, soma + NEW.valor_maximo, teto USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checar_soma_atividades ON public.pedagogico_atividades_avaliativas;
CREATE TRIGGER checar_soma_atividades
  BEFORE INSERT OR UPDATE OF valor_maximo, trimestre, turma_nome, disciplina_id
  ON public.pedagogico_atividades_avaliativas
  FOR EACH ROW EXECUTE FUNCTION public.pedagogico_checar_soma_atividades();

-- ─── Notas por atividade ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_notas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atividade_id uuid NOT NULL REFERENCES public.pedagogico_atividades_avaliativas (id) ON DELETE CASCADE,
  sponte_aluno_id text NOT NULL,
  nota numeric(6,2) NOT NULL CHECK (nota >= 0),
  lancado_por uuid REFERENCES public.funcionarios (id) ON DELETE SET NULL,
  lancado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (atividade_id, sponte_aluno_id)
);

CREATE INDEX IF NOT EXISTS pedagogico_notas_aluno_idx
  ON public.pedagogico_notas (sponte_aluno_id);

-- Nota nunca acima do valor máximo da atividade.
CREATE OR REPLACE FUNCTION public.pedagogico_checar_nota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE teto numeric;
BEGIN
  SELECT valor_maximo INTO teto FROM public.pedagogico_atividades_avaliativas WHERE id = NEW.atividade_id;
  IF NEW.nota > teto THEN
    RAISE EXCEPTION 'Nota % acima do valor máximo da atividade (%).', NEW.nota, teto
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.lancado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checar_nota ON public.pedagogico_notas;
CREATE TRIGGER checar_nota BEFORE INSERT OR UPDATE ON public.pedagogico_notas
  FOR EACH ROW EXECUTE FUNCTION public.pedagogico_checar_nota();

-- ─── Recuperação de trimestre (só 1º e 2º; vale 30) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_recuperacoes_trimestre (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  turma_nome text NOT NULL,
  disciplina_id uuid NOT NULL REFERENCES public.disciplinas (id) ON DELETE CASCADE,
  trimestre smallint NOT NULL CHECK (trimestre IN (1, 2)),
  sponte_aluno_id text NOT NULL,
  nota numeric(6,2) NOT NULL CHECK (nota BETWEEN 0 AND 30),
  lancado_por uuid REFERENCES public.funcionarios (id) ON DELETE SET NULL,
  lancado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, ano_letivo, turma_nome, disciplina_id, trimestre, sponte_aluno_id)
);

-- ─── Recuperação final (vale 100) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_recuperacoes_finais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  turma_nome text NOT NULL,
  disciplina_id uuid NOT NULL REFERENCES public.disciplinas (id) ON DELETE CASCADE,
  sponte_aluno_id text NOT NULL,
  nota numeric(6,2) NOT NULL CHECK (nota BETWEEN 0 AND 100),
  lancado_por uuid REFERENCES public.funcionarios (id) ON DELETE SET NULL,
  lancado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, ano_letivo, turma_nome, disciplina_id, sponte_aluno_id)
);

-- ─── Parecer descritivo (Infantil) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedagogico_pareceres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  turma_nome text NOT NULL,
  sponte_aluno_id text NOT NULL,
  professor_id uuid NOT NULL REFERENCES public.funcionarios (id) ON DELETE RESTRICT,
  trimestre smallint NOT NULL CHECK (trimestre BETWEEN 1 AND 3),
  texto text NOT NULL,
  lancado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, ano_letivo, turma_nome, sponte_aluno_id, trimestre)
);

CREATE INDEX IF NOT EXISTS pedagogico_pareceres_turma_idx
  ON public.pedagogico_pareceres (school_id, ano_letivo, turma_nome, trimestre);

CREATE OR REPLACE FUNCTION public.pedagogico_marcar_lancado_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.lancado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marcar_lancado_em ON public.pedagogico_recuperacoes_trimestre;
CREATE TRIGGER marcar_lancado_em BEFORE UPDATE ON public.pedagogico_recuperacoes_trimestre
  FOR EACH ROW EXECUTE FUNCTION public.pedagogico_marcar_lancado_em();
DROP TRIGGER IF EXISTS marcar_lancado_em ON public.pedagogico_recuperacoes_finais;
CREATE TRIGGER marcar_lancado_em BEFORE UPDATE ON public.pedagogico_recuperacoes_finais
  FOR EACH ROW EXECUTE FUNCTION public.pedagogico_marcar_lancado_em();
DROP TRIGGER IF EXISTS marcar_lancado_em ON public.pedagogico_pareceres;
CREATE TRIGGER marcar_lancado_em BEFORE UPDATE ON public.pedagogico_pareceres
  FOR EACH ROW EXECUTE FUNCTION public.pedagogico_marcar_lancado_em();

DROP TRIGGER IF EXISTS set_updated_at ON public.pedagogico_atividades_avaliativas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pedagogico_atividades_avaliativas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Funções de acesso pela atividade (para pedagogico_notas) ───────────────
CREATE OR REPLACE FUNCTION public.pedagogico_atividade_pode_ver(_user_id uuid, _atividade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pedagogico_atividades_avaliativas a
     WHERE a.id = _atividade_id
       AND (public.pedagogico_pode_ver(_user_id, a.school_id)
            OR public.professor_leciona_disciplina(_user_id, a.school_id, a.ano_letivo, a.turma_nome, a.disciplina_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.pedagogico_atividade_pode_lancar(_user_id uuid, _atividade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pedagogico_atividades_avaliativas a
     WHERE a.id = _atividade_id
       AND (public.pedagogico_pode_editar(_user_id, a.school_id)
            OR public.professor_leciona_disciplina(_user_id, a.school_id, a.ano_letivo, a.turma_nome, a.disciplina_id))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.pedagogico_atividade_pode_ver(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pedagogico_atividade_pode_lancar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedagogico_atividade_pode_ver(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pedagogico_atividade_pode_lancar(uuid, uuid) TO authenticated;

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.pedagogico_atividades_avaliativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedagogico_notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedagogico_recuperacoes_trimestre ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedagogico_recuperacoes_finais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedagogico_pareceres ENABLE ROW LEVEL SECURITY;

-- Atividades e recuperações de trimestre: secretaria tudo; professor só a
-- própria atribuição (turma+disciplina).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pedagogico_atividades_avaliativas', 'pedagogico_recuperacoes_trimestre'] LOOP
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
      'CREATE POLICY "professor lanca %s" ON public.%I FOR ALL TO authenticated USING (public.professor_leciona_disciplina(auth.uid(), school_id, ano_letivo, turma_nome, disciplina_id)) WITH CHECK (public.professor_leciona_disciplina(auth.uid(), school_id, ano_letivo, turma_nome, disciplina_id))',
      t, t);
  END LOOP;
END $$;

-- Atividade criada pelo professor precisa levar o próprio professor_id.
DROP POLICY IF EXISTS "professor lanca pedagogico_atividades_avaliativas" ON public.pedagogico_atividades_avaliativas;
CREATE POLICY "professor lanca pedagogico_atividades_avaliativas" ON public.pedagogico_atividades_avaliativas
  FOR ALL TO authenticated
  USING (
    professor_id = public.professor_funcionario_id(auth.uid())
    AND public.professor_leciona_disciplina(auth.uid(), school_id, ano_letivo, turma_nome, disciplina_id)
  )
  WITH CHECK (
    professor_id = public.professor_funcionario_id(auth.uid())
    AND public.professor_leciona_disciplina(auth.uid(), school_id, ano_letivo, turma_nome, disciplina_id)
  );

-- Notas: a regra vem da atividade (turma+disciplina).
DROP POLICY IF EXISTS "pedagogico view pedagogico_notas" ON public.pedagogico_notas;
CREATE POLICY "pedagogico view pedagogico_notas" ON public.pedagogico_notas
  FOR SELECT TO authenticated
  USING (public.pedagogico_atividade_pode_ver(auth.uid(), atividade_id));

DROP POLICY IF EXISTS "pedagogico lanca pedagogico_notas" ON public.pedagogico_notas;
CREATE POLICY "pedagogico lanca pedagogico_notas" ON public.pedagogico_notas
  FOR ALL TO authenticated
  USING (public.pedagogico_atividade_pode_lancar(auth.uid(), atividade_id))
  WITH CHECK (public.pedagogico_atividade_pode_lancar(auth.uid(), atividade_id));

-- Recuperação final: secretaria lança; professor da disciplina só lê.
DROP POLICY IF EXISTS "pedagogico edit pedagogico_recuperacoes_finais" ON public.pedagogico_recuperacoes_finais;
CREATE POLICY "pedagogico edit pedagogico_recuperacoes_finais" ON public.pedagogico_recuperacoes_finais
  FOR ALL TO authenticated
  USING (public.pedagogico_pode_editar(auth.uid(), school_id))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id));

DROP POLICY IF EXISTS "pedagogico view pedagogico_recuperacoes_finais" ON public.pedagogico_recuperacoes_finais;
CREATE POLICY "pedagogico view pedagogico_recuperacoes_finais" ON public.pedagogico_recuperacoes_finais
  FOR SELECT TO authenticated
  USING (
    public.pedagogico_pode_ver(auth.uid(), school_id)
    OR public.professor_leciona_disciplina(auth.uid(), school_id, ano_letivo, turma_nome, disciplina_id)
  );

-- Pareceres: secretaria tudo; professor com atribuição na TURMA (qualquer
-- disciplina — o Infantil pode não ter disciplinas separadas), com o próprio
-- professor_id.
DROP POLICY IF EXISTS "pedagogico edit pedagogico_pareceres" ON public.pedagogico_pareceres;
CREATE POLICY "pedagogico edit pedagogico_pareceres" ON public.pedagogico_pareceres
  FOR ALL TO authenticated
  USING (public.pedagogico_pode_editar(auth.uid(), school_id))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id));

DROP POLICY IF EXISTS "pedagogico view pedagogico_pareceres" ON public.pedagogico_pareceres;
CREATE POLICY "pedagogico view pedagogico_pareceres" ON public.pedagogico_pareceres
  FOR SELECT TO authenticated
  USING (
    public.pedagogico_pode_ver(auth.uid(), school_id)
    OR public.professor_leciona_turma(auth.uid(), school_id, ano_letivo, turma_nome)
  );

DROP POLICY IF EXISTS "professor lanca pedagogico_pareceres" ON public.pedagogico_pareceres;
CREATE POLICY "professor lanca pedagogico_pareceres" ON public.pedagogico_pareceres
  FOR ALL TO authenticated
  USING (
    professor_id = public.professor_funcionario_id(auth.uid())
    AND public.professor_leciona_turma(auth.uid(), school_id, ano_letivo, turma_nome)
  )
  WITH CHECK (
    professor_id = public.professor_funcionario_id(auth.uid())
    AND public.professor_leciona_turma(auth.uid(), school_id, ano_letivo, turma_nome)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedagogico_atividades_avaliativas,
  public.pedagogico_notas, public.pedagogico_recuperacoes_trimestre,
  public.pedagogico_recuperacoes_finais, public.pedagogico_pareceres TO authenticated;
GRANT ALL ON public.pedagogico_atividades_avaliativas, public.pedagogico_notas,
  public.pedagogico_recuperacoes_trimestre, public.pedagogico_recuperacoes_finais,
  public.pedagogico_pareceres TO service_role;
