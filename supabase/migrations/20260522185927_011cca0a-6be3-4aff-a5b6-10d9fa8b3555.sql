-- Helper: replace each "FOR ALL ... USING(true) WITH CHECK(true)" policy with
-- separate SELECT (authenticated) and write (admin-only) policies.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'boleto_category_mappings',
    'boleto_reconciliation_items',
    'boleto_reconciliations',
    'categorization_rules',
    'cost_centers',
    'initial_balances',
    'reconciliations',
    'recurring_forecasts',
    'revenue_categories',
    'revenue_subcategories',
    'sub_cost_centers',
    'transactions'
  ];
  policy_names text[] := ARRAY[
    'auth all boleto_map',
    'auth all boleto_recon_items',
    'auth all boleto_recon',
    'auth all rules',
    'auth all cc',
    'auth all initial_balances',
    'auth all reconciliations',
    'auth all recurring_forecasts',
    'auth all rev_cat',
    'auth all rev_sub',
    'auth all sub_cc',
    'auth all tx'
  ];
  i int;
BEGIN
  FOR i IN 1..array_length(tables, 1) LOOP
    t := tables[i];
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_names[i], t);
    EXECUTE format(
      'CREATE POLICY "auth read %s" ON public.%I FOR SELECT TO authenticated USING (true)',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "admin insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), ''admin''::public.app_role))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "admin update %s" ON public.%I FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), ''admin''::public.app_role)) WITH CHECK (public.has_role(auth.uid(), ''admin''::public.app_role))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "admin delete %s" ON public.%I FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''admin''::public.app_role))',
      t, t
    );
  END LOOP;
END $$;

-- schools table: replace permissive insert/update/delete with admin-only equivalents
DROP POLICY IF EXISTS "auth insert schools" ON public.schools;
DROP POLICY IF EXISTS "auth update schools" ON public.schools;
DROP POLICY IF EXISTS "auth delete schools" ON public.schools;

CREATE POLICY "admin insert schools" ON public.schools
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "admin update schools" ON public.schools
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "admin delete schools" ON public.schools
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));