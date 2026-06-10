-- Pacote 2 (Médias) — Isolamento de dados entre unidades (RLS) + Fail-closed.
--
-- 1) Escritas do Financeiro (transactions, recurring_forecasts): além do SELECT
--    (já escopado em 20260615120000), INSERT/UPDATE/DELETE passam a exigir
--    can_access_school(school_id).
-- 2) PII (leads, onboarding, funcionarios): SELECT/INSERT/UPDATE/DELETE passam a
--    exigir can_access_school(school_id) — usuário só vê/edita as unidades às
--    quais tem permissão explícita.
-- 3) Fail-closed: can_access_school deixa de tratar "sem vínculo = acesso global".
--    Antes de virar a chave, fazemos backfill dos usuários não-admin sem vínculo
--    com TODAS as escolas, preservando exatamente o acesso que têm hoje (legacy
--    fail-open). Assim ninguém perde acesso; o default só muda para novos perfis.

-- ============================================================================
-- (3a) BACKFILL — materializa o acesso global implícito ANTES do fail-closed.
-- Todo usuário não-admin que hoje NÃO tem nenhuma linha em user_schools é
-- tratado como "todas as escolas" (legacy). Inserimos linhas explícitas para
-- todas as escolas, preservando o acesso atual antes de remover o fail-open.
-- ============================================================================
INSERT INTO public.user_schools (user_id, school_id)
SELECT u.id, s.id
FROM auth.users u
CROSS JOIN public.schools s
WHERE NOT public.has_role(u.id, 'admin'::public.app_role)
  AND NOT EXISTS (SELECT 1 FROM public.user_schools us WHERE us.user_id = u.id)
ON CONFLICT (user_id, school_id) DO NOTHING;

-- ============================================================================
-- (3b) can_access_school -> FAIL-CLOSED.
-- Admin sempre passa. Caso contrário, a escola precisa estar explicitamente no
-- conjunto do usuário. Sem vínculo => acesso NEGADO (não mais global).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_access_school(_user_id uuid, _school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_schools
      WHERE user_id = _user_id AND school_id = _school_id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_school(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_school(uuid, uuid) TO authenticated;

-- ============================================================================
-- (1) FINANCEIRO — escopo de escola também nas ESCRITAS.
-- transactions e recurring_forecasts têm school_id NOT NULL.
-- ============================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['transactions', 'recurring_forecasts'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "fin insert %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "fin insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), ''financeiro''::public.app_module) AND public.can_access_school(auth.uid(), school_id))',
      t, t);

    EXECUTE format('DROP POLICY IF EXISTS "fin update %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "fin update %s" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), ''financeiro''::public.app_module) AND public.can_access_school(auth.uid(), school_id)) WITH CHECK (public.can_edit_module(auth.uid(), ''financeiro''::public.app_module) AND public.can_access_school(auth.uid(), school_id))',
      t, t);

    EXECUTE format('DROP POLICY IF EXISTS "fin delete %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "fin delete %s" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), ''financeiro''::public.app_module) AND public.can_access_school(auth.uid(), school_id))',
      t, t);
  END LOOP;
END $$;

-- ============================================================================
-- (2) PII — leads (admissoes), onboarding (onboarding), funcionarios (rh).
-- Todas as tabelas têm school_id NOT NULL. Cada operação exige o módulo
-- correspondente E can_access_school(school_id).
-- ============================================================================

-- ---------- leads -> admissoes ----------
DROP POLICY IF EXISTS "view leads" ON public.leads;
CREATE POLICY "view leads" ON public.leads
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'admissoes') AND public.can_access_school(auth.uid(), school_id));

DROP POLICY IF EXISTS "edit insert leads" ON public.leads;
CREATE POLICY "edit insert leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'admissoes') AND public.can_access_school(auth.uid(), school_id));

DROP POLICY IF EXISTS "edit update leads" ON public.leads;
CREATE POLICY "edit update leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'admissoes') AND public.can_access_school(auth.uid(), school_id))
  WITH CHECK (public.can_edit_module(auth.uid(), 'admissoes') AND public.can_access_school(auth.uid(), school_id));

DROP POLICY IF EXISTS "edit delete leads" ON public.leads;
CREATE POLICY "edit delete leads" ON public.leads
  FOR DELETE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'admissoes') AND public.can_access_school(auth.uid(), school_id));

-- ---------- onboarding -> onboarding ----------
DROP POLICY IF EXISTS "view onboarding" ON public.onboarding;
CREATE POLICY "view onboarding" ON public.onboarding
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'onboarding') AND public.can_access_school(auth.uid(), school_id));

DROP POLICY IF EXISTS "edit insert onboarding" ON public.onboarding;
CREATE POLICY "edit insert onboarding" ON public.onboarding
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'onboarding') AND public.can_access_school(auth.uid(), school_id));

DROP POLICY IF EXISTS "edit update onboarding" ON public.onboarding;
CREATE POLICY "edit update onboarding" ON public.onboarding
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'onboarding') AND public.can_access_school(auth.uid(), school_id))
  WITH CHECK (public.can_edit_module(auth.uid(), 'onboarding') AND public.can_access_school(auth.uid(), school_id));

DROP POLICY IF EXISTS "edit delete onboarding" ON public.onboarding;
CREATE POLICY "edit delete onboarding" ON public.onboarding
  FOR DELETE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'onboarding') AND public.can_access_school(auth.uid(), school_id));

-- ---------- funcionarios -> rh ----------
DROP POLICY IF EXISTS "view funcionarios" ON public.funcionarios;
CREATE POLICY "view funcionarios" ON public.funcionarios
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rh') AND public.can_access_school(auth.uid(), school_id));

DROP POLICY IF EXISTS "edit insert funcionarios" ON public.funcionarios;
CREATE POLICY "edit insert funcionarios" ON public.funcionarios
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'rh') AND public.can_access_school(auth.uid(), school_id));

DROP POLICY IF EXISTS "edit update funcionarios" ON public.funcionarios;
CREATE POLICY "edit update funcionarios" ON public.funcionarios
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'rh') AND public.can_access_school(auth.uid(), school_id))
  WITH CHECK (public.can_edit_module(auth.uid(), 'rh') AND public.can_access_school(auth.uid(), school_id));

DROP POLICY IF EXISTS "edit delete funcionarios" ON public.funcionarios;
CREATE POLICY "edit delete funcionarios" ON public.funcionarios
  FOR DELETE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'rh') AND public.can_access_school(auth.uid(), school_id));
