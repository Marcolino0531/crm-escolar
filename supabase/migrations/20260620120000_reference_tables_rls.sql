-- Pacote 3 (Baixas) — Proteção das tabelas de referência (Configurações).
--
-- Tabelas estruturais lidas para montar dropdowns em todo o app:
--   cost_centers, categorization_rules, sub_cost_centers,
--   revenue_categories, revenue_subcategories
--
-- Regra:
--   • SELECT  → aberto para qualquer usuário autenticado (o sistema precisa ler
--               essas tabelas para montar os dropdowns em várias telas).
--   • INSERT/UPDATE/DELETE → restrito a quem pode editar Configurações OU
--               Financeiro (can_edit_module('configuracoes') OR
--               can_edit_module('financeiro')).

DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY[
    'cost_centers',
    'categorization_rules',
    'sub_cost_centers',
    'revenue_categories',
    'revenue_subcategories'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Garante RLS ligado (idempotente; já está habilitado nestas tabelas).
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Remove todas as policies anteriores para nenhuma permissiva sobrar (OR-bypass).
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- SELECT aberto para autenticados.
    EXECUTE format(
      'CREATE POLICY "ref view %s" ON public.%I FOR SELECT TO authenticated USING (true)',
      t, t);

    -- Escritas: editor de Configurações OU de Financeiro.
    EXECUTE format(
      'CREATE POLICY "ref insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), ''configuracoes''::public.app_module) OR public.can_edit_module(auth.uid(), ''financeiro''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "ref update %s" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), ''configuracoes''::public.app_module) OR public.can_edit_module(auth.uid(), ''financeiro''::public.app_module)) WITH CHECK (public.can_edit_module(auth.uid(), ''configuracoes''::public.app_module) OR public.can_edit_module(auth.uid(), ''financeiro''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "ref delete %s" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), ''configuracoes''::public.app_module) OR public.can_edit_module(auth.uid(), ''financeiro''::public.app_module))',
      t, t);
  END LOOP;
END $$;
