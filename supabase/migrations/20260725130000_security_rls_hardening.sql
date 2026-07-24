-- Segurança — corrige leitura excessivamente permissiva (SELECT USING (true)) em
-- tabelas que vazavam dados para QUALQUER usuário autenticado, inclusive um
-- signup público sem role/permissão/escola.
--
-- Regra nova de leitura:
--   • schools / provision_funds (têm school_id)  → admin OU membro daquela escola
--   • provision_fund_entries (via fund_id)        → admin OU membro da escola do fundo
--   • catálogos globais de finanças (cost_centers, sub_cost_centers,
--     categorization_rules, revenue_categories, revenue_subcategories)
--                                                 → admin OU membro de ALGUMA escola
--
-- Não-autenticado: 0 linhas (policies são TO authenticated). As policies de
-- escrita (admin / can_edit_module) já eram corretas e permanecem inalteradas.

-- ─── Helpers (SECURITY DEFINER: ignoram RLS ao checar vínculo, como has_role) ──
CREATE OR REPLACE FUNCTION public.is_school_member(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.user_schools WHERE user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.has_school_access(_user_id uuid, _school_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_schools
      WHERE user_id = _user_id AND school_id = _school_id
    );
$$;

CREATE OR REPLACE FUNCTION public.has_provision_fund_access(_user_id uuid, _fund_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.provision_funds f
    WHERE f.id = _fund_id AND public.has_school_access(_user_id, f.school_id)
  );
$$;

-- ─── schools: leitura só de escolas às quais o usuário pertence (admin = todas) ─
DROP POLICY IF EXISTS "auth read schools" ON public.schools;
CREATE POLICY "member read schools" ON public.schools
  FOR SELECT TO authenticated
  USING (public.has_school_access(auth.uid(), id));

-- ─── Catálogos globais de finanças: só admin ou membro de alguma escola ────────
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'cost_centers', 'sub_cost_centers', 'categorization_rules',
    'revenue_categories', 'revenue_subcategories'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "ref view %1$s" ON public.%1$s', tbl);
    EXECUTE format(
      'CREATE POLICY "ref view %1$s" ON public.%1$s FOR SELECT TO authenticated '
      || 'USING (public.is_school_member(auth.uid()))',
      tbl
    );
  END LOOP;
END $$;

-- ─── provision_funds / provision_fund_entries: escopo por escola do fundo ──────
DROP POLICY IF EXISTS "auth read provision_funds" ON public.provision_funds;
CREATE POLICY "member read provision_funds" ON public.provision_funds
  FOR SELECT TO authenticated
  USING (public.has_school_access(auth.uid(), school_id));

DROP POLICY IF EXISTS "auth read provision_fund_entries" ON public.provision_fund_entries;
CREATE POLICY "member read provision_fund_entries" ON public.provision_fund_entries
  FOR SELECT TO authenticated
  USING (public.has_provision_fund_access(auth.uid(), fund_id));
