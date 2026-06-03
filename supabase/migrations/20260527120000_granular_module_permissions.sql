-- Granular per-module access control.
-- Replaces the simple admin/viewer model (kept for "super admin") with a matrix
-- of per-module View/Edit permissions stored in public.user_permissions.
-- Modules: admissoes, onboarding, rh, financeiro, configuracoes.

-- ---------- Module enum ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_module') THEN
    CREATE TYPE public.app_module AS ENUM (
      'admissoes',
      'onboarding',
      'rh',
      'financeiro',
      'configuracoes'
    );
  END IF;
END $$;

-- ---------- Permissions table ----------
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module public.app_module NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module)
);

CREATE INDEX IF NOT EXISTS user_permissions_user_id_idx ON public.user_permissions (user_id);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS user_permissions_set_updated_at ON public.user_permissions;
CREATE TRIGGER user_permissions_set_updated_at BEFORE UPDATE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Helper functions (security definer, no RLS recursion) ----------
-- Edit implies view. Admins (user_roles.role = 'admin') always pass.
CREATE OR REPLACE FUNCTION public.can_view_module(_user_id uuid, _module public.app_module)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = _user_id AND module = _module AND (can_view OR can_edit)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_module(_user_id uuid, _module public.app_module)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = _user_id AND module = _module AND can_edit
    );
$$;

-- Returns the current user's permission matrix (used by the client).
CREATE OR REPLACE FUNCTION public.current_user_permissions()
RETURNS TABLE (module public.app_module, can_view boolean, can_edit boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT module, can_view, can_edit
  FROM public.user_permissions
  WHERE user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.can_view_module(uuid, public.app_module) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_module(uuid, public.app_module) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_module(uuid, public.app_module) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_module(uuid, public.app_module) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_permissions() TO authenticated;

-- ---------- RLS on user_permissions ----------
DROP POLICY IF EXISTS "users read own permissions" ON public.user_permissions;
CREATE POLICY "users read own permissions" ON public.user_permissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins manage permissions" ON public.user_permissions;
CREATE POLICY "admins manage permissions" ON public.user_permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- Backfill: preserve current behavior ----------
-- Existing non-admin users could read everything (viewer). Grant them view-only
-- on every module so they are not locked out when the new checks take effect.
INSERT INTO public.user_permissions (user_id, module, can_view, can_edit)
SELECT u.id, m.module, true, false
FROM auth.users u
CROSS JOIN (
  SELECT unnest(enum_range(NULL::public.app_module)) AS module
) m
WHERE NOT public.has_role(u.id, 'admin'::public.app_role)
ON CONFLICT (user_id, module) DO NOTHING;

-- ---------- CRM module tables: enforce per-module permissions ----------
-- leads -> admissoes, onboarding -> onboarding, funcionarios -> rh
DROP POLICY IF EXISTS "auth all leads" ON public.leads;
CREATE POLICY "view leads" ON public.leads
  FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), 'admissoes'));
CREATE POLICY "edit insert leads" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), 'admissoes'));
CREATE POLICY "edit update leads" ON public.leads
  FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), 'admissoes'))
  WITH CHECK (public.can_edit_module(auth.uid(), 'admissoes'));
CREATE POLICY "edit delete leads" ON public.leads
  FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), 'admissoes'));

DROP POLICY IF EXISTS "auth all onboarding" ON public.onboarding;
CREATE POLICY "view onboarding" ON public.onboarding
  FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), 'onboarding'));
CREATE POLICY "edit insert onboarding" ON public.onboarding
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), 'onboarding'));
CREATE POLICY "edit update onboarding" ON public.onboarding
  FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), 'onboarding'))
  WITH CHECK (public.can_edit_module(auth.uid(), 'onboarding'));
CREATE POLICY "edit delete onboarding" ON public.onboarding
  FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), 'onboarding'));

DROP POLICY IF EXISTS "auth all funcionarios" ON public.funcionarios;
CREATE POLICY "view funcionarios" ON public.funcionarios
  FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), 'rh'));
CREATE POLICY "edit insert funcionarios" ON public.funcionarios
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), 'rh'));
CREATE POLICY "edit update funcionarios" ON public.funcionarios
  FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), 'rh'))
  WITH CHECK (public.can_edit_module(auth.uid(), 'rh'));
CREATE POLICY "edit delete funcionarios" ON public.funcionarios
  FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), 'rh'));

-- ---------- Financeiro data tables: view requires financeiro view, writes require financeiro edit ----------
DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY[
    'boleto_reconciliation_items',
    'boleto_reconciliations',
    'initial_balances',
    'reconciliations',
    'recurring_forecasts',
    'recurring_series',
    'transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop every prior policy on the table so old permissive ones can't OR-bypass.
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "fin view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''financeiro''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "fin insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), ''financeiro''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "fin update %s" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), ''financeiro''::public.app_module)) WITH CHECK (public.can_edit_module(auth.uid(), ''financeiro''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "fin delete %s" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), ''financeiro''::public.app_module))',
      t, t);
  END LOOP;
END $$;

-- ---------- Configurações reference tables ----------
-- These are managed in the Configurações screen (writes require configuracoes edit)
-- but are read by the Financeiro views, so SELECT is allowed for financeiro OR
-- configuracoes viewers.
DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY[
    'boleto_category_mappings',
    'categorization_rules',
    'cost_centers',
    'revenue_categories',
    'revenue_subcategories',
    'sub_cost_centers'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop every prior policy on the table so old permissive ones can't OR-bypass.
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "cfg view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''financeiro''::public.app_module) OR public.can_view_module(auth.uid(), ''configuracoes''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "cfg insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), ''configuracoes''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "cfg update %s" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), ''configuracoes''::public.app_module)) WITH CHECK (public.can_edit_module(auth.uid(), ''configuracoes''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "cfg delete %s" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), ''configuracoes''::public.app_module))',
      t, t);
  END LOOP;
END $$;
