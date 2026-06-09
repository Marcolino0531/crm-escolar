-- RBAC por unidade no nível de linha (RLS): leitura escopada por escola.
--
-- As telas Dashboard e Extrato leem `transactions`; o Fluxo Futuro lê
-- `recurring_forecasts`. Antes, a política de SELECT exigia apenas a permissão
-- do módulo Financeiro (can_view_module), sem olhar a escola da linha — então um
-- usuário restrito a algumas unidades conseguia ler os dados de TODAS forçando
-- uma consulta consolidada. Agora a leitura também exige can_access_school sobre
-- o school_id da linha.
--
-- can_access_school (migration 20260527140000) já trata:
--   • admin            → acesso a todas as escolas
--   • sem rows em user_schools (legacy) → acesso global (não trava ninguém)
--   • restrito         → apenas as escolas explicitamente permitidas
--
-- Mantemos as políticas de INSERT/UPDATE/DELETE inalteradas (can_edit_module):
-- a correção é sobre EXPOSIÇÃO DE LEITURA dos totais consolidados.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['transactions', 'recurring_forecasts'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "fin view %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "fin view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''financeiro''::public.app_module) AND public.can_access_school(auth.uid(), school_id))',
      t, t);
  END LOOP;
END $$;
