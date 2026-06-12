-- Cobrança: migração de dados + repontamento das policies para a nova chave
-- 'financeiro_cobranca' (ver migration 20260623120000_financeiro_cobranca_enum).

-- 1) Migra permissões já concedidas com a chave antiga para a nova. Preserva o
--    acesso de quem já tinha Cobrança ativada. Em caso de colisão (linha já
--    existente para 'financeiro_cobranca'), mantém a existente e remove a antiga.
UPDATE public.user_permissions up
SET module = 'financeiro_cobranca'::public.app_module
WHERE up.module = 'cobranca'::public.app_module
  AND NOT EXISTS (
    SELECT 1 FROM public.user_permissions x
    WHERE x.user_id = up.user_id
      AND x.module = 'financeiro_cobranca'::public.app_module
  );

DELETE FROM public.user_permissions
WHERE module = 'cobranca'::public.app_module;

-- 2) Repointa as policies das tabelas de Cobrança para a nova chave.
--    SELECT exige can_view_module('financeiro_cobranca'); escrita exige
--    can_edit_module('financeiro_cobranca'). Admin sempre passa.
DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY['cobranca_checklist', 'cobranca_envios'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "cobranca view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''financeiro_cobranca''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "cobranca insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), ''financeiro_cobranca''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "cobranca update %s" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), ''financeiro_cobranca''::public.app_module)) WITH CHECK (public.can_edit_module(auth.uid(), ''financeiro_cobranca''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "cobranca delete %s" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), ''financeiro_cobranca''::public.app_module))',
      t, t);
  END LOOP;
END $$;
