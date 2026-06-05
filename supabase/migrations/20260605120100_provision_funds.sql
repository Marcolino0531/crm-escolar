-- Provisioning funds (Fundos) feature for the Financeiro module.
--
-- Two tables:
--   • provision_funds         — fund registry (name + provisioning destination),
--                               scoped to a school.
--   • provision_fund_entries  — monthly closing balance ("Valor Líquido
--                               Atualizado") per fund, one row per competência.
--
-- RLS mirrors the other Financeiro tables: any authenticated user may read,
-- writes are admin-only (the UI additionally gates by the financeiro_fundos
-- permission).

-- ---------- Tables ----------
CREATE TABLE IF NOT EXISTS public.provision_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  destination text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provision_funds_school_id_idx
  ON public.provision_funds (school_id);

CREATE TABLE IF NOT EXISTS public.provision_fund_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES public.provision_funds(id) ON DELETE CASCADE,
  -- First day of the competência month (e.g. 2026-06-01).
  competencia date NOT NULL,
  valor_liquido numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fund_id, competencia)
);

CREATE INDEX IF NOT EXISTS provision_fund_entries_fund_id_idx
  ON public.provision_fund_entries (fund_id);

-- ---------- RLS ----------
ALTER TABLE public.provision_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provision_fund_entries ENABLE ROW LEVEL SECURITY;

-- provision_funds
DROP POLICY IF EXISTS "auth read provision_funds" ON public.provision_funds;
CREATE POLICY "auth read provision_funds" ON public.provision_funds
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin insert provision_funds" ON public.provision_funds;
CREATE POLICY "admin insert provision_funds" ON public.provision_funds
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin update provision_funds" ON public.provision_funds;
CREATE POLICY "admin update provision_funds" ON public.provision_funds
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin delete provision_funds" ON public.provision_funds;
CREATE POLICY "admin delete provision_funds" ON public.provision_funds
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- provision_fund_entries
DROP POLICY IF EXISTS "auth read provision_fund_entries" ON public.provision_fund_entries;
CREATE POLICY "auth read provision_fund_entries" ON public.provision_fund_entries
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin insert provision_fund_entries" ON public.provision_fund_entries;
CREATE POLICY "admin insert provision_fund_entries" ON public.provision_fund_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin update provision_fund_entries" ON public.provision_fund_entries;
CREATE POLICY "admin update provision_fund_entries" ON public.provision_fund_entries
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin delete provision_fund_entries" ON public.provision_fund_entries;
CREATE POLICY "admin delete provision_fund_entries" ON public.provision_fund_entries
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- Backfill permission ----------
-- Give existing users the same access to the new sub-tab as their umbrella
-- 'financeiro' permission, so nothing changes for them on rollout.
INSERT INTO public.user_permissions (user_id, module, can_view, can_edit)
SELECT up.user_id, 'financeiro_fundos'::public.app_module, up.can_view, up.can_edit
FROM public.user_permissions up
WHERE up.module = 'financeiro'
ON CONFLICT (user_id, module) DO NOTHING;

-- Force PostgREST to reload its schema cache so the REST API immediately sees
-- the new tables.
NOTIFY pgrst, 'reload schema';
