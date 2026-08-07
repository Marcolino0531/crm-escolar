-- Repointa a RLS das tabelas de chat do WhatsApp para o novo submódulo
-- 'financeiro_atendimento' (antes espelhava 'cobranca'). Assim, a permissão de
-- Atendimento controla de fato o acesso aos dados da tela (leitura/escrita).
-- Admin sempre passa; fail-closed. Backfill: quem já tinha 'financeiro_cobranca'
-- recebe 'financeiro_atendimento' equivalente, para não perder acesso.

-- Backfill de permissões: copia can_view/can_edit de financeiro_cobranca para
-- financeiro_atendimento (sem sobrescrever concessões já existentes).
INSERT INTO public.user_permissions (user_id, module, can_view, can_edit)
SELECT user_id, 'financeiro_atendimento'::public.app_module, can_view, can_edit
FROM public.user_permissions
WHERE module = 'financeiro_cobranca'::public.app_module
ON CONFLICT (user_id, module) DO NOTHING;

DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['whatsapp_conversations', 'whatsapp_messages']
  LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "atendimento view %1$s" ON public.%1$s FOR SELECT TO authenticated '
      || 'USING (public.can_view_module(auth.uid(), ''financeiro_atendimento''::public.app_module))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "atendimento insert %1$s" ON public.%1$s FOR INSERT TO authenticated '
      || 'WITH CHECK (public.can_edit_module(auth.uid(), ''financeiro_atendimento''::public.app_module))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "atendimento update %1$s" ON public.%1$s FOR UPDATE TO authenticated '
      || 'USING (public.can_edit_module(auth.uid(), ''financeiro_atendimento''::public.app_module)) '
      || 'WITH CHECK (public.can_edit_module(auth.uid(), ''financeiro_atendimento''::public.app_module))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "atendimento delete %1$s" ON public.%1$s FOR DELETE TO authenticated '
      || 'USING (public.can_edit_module(auth.uid(), ''financeiro_atendimento''::public.app_module))',
      tbl
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
