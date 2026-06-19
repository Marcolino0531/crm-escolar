-- Módulo "Cobrança" — log de disparos de WhatsApp (Histórico de Envios).
--
-- Registra o resultado de cada disparo de cobrança via WhatsApp. Hoje o envio é
-- manual (link wa.me + registro na régua) e grava sempre status 'sucesso'; o
-- campo de erro/erro_mensagem fica pronto para quando a integração com a
-- WhatsApp Cloud API da Meta for adicionada (disparo automático/Reenviar).
--
-- fatura_id é uma REFERÊNCIA textual (não FK): a fatura/boleto vem do Sponte
-- (sistema externo), não há tabela local de faturas.
--
-- RLS: leitura exige can_view_module('cobranca'); escrita exige
-- can_edit_module('cobranca'). Admin sempre passa. Fail-closed por padrão.

CREATE TABLE IF NOT EXISTS public.whatsapp_billing_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_envio timestamptz NOT NULL DEFAULT now(),
  responsavel_name text NOT NULL DEFAULT '',
  telefone text NOT NULL DEFAULT '',
  -- Unidade/núcleo (ex.: 'Núcleo Belvedere', 'CEC').
  unidade text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sucesso' CHECK (status IN ('sucesso', 'erro')),
  erro_mensagem text,
  -- Referência ao boleto/perfil de cobrança (Sponte é externo; sem FK local).
  fatura_id text,
  enviado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_billing_logs_data_idx
  ON public.whatsapp_billing_logs (data_envio DESC);
CREATE INDEX IF NOT EXISTS whatsapp_billing_logs_status_idx
  ON public.whatsapp_billing_logs (status);
CREATE INDEX IF NOT EXISTS whatsapp_billing_logs_unidade_idx
  ON public.whatsapp_billing_logs (unidade);

ALTER TABLE public.whatsapp_billing_logs ENABLE ROW LEVEL SECURITY;

-- ─── Policies (idempotentes; espelham as tabelas de Cobrança) ─────────────────
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_billing_logs'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_billing_logs', pol.policyname);
  END LOOP;

  CREATE POLICY "cobranca view whatsapp_billing_logs" ON public.whatsapp_billing_logs
    FOR SELECT TO authenticated
    USING (public.can_view_module(auth.uid(), 'cobranca'::public.app_module));
  CREATE POLICY "cobranca insert whatsapp_billing_logs" ON public.whatsapp_billing_logs
    FOR INSERT TO authenticated
    WITH CHECK (public.can_edit_module(auth.uid(), 'cobranca'::public.app_module));
  CREATE POLICY "cobranca update whatsapp_billing_logs" ON public.whatsapp_billing_logs
    FOR UPDATE TO authenticated
    USING (public.can_edit_module(auth.uid(), 'cobranca'::public.app_module))
    WITH CHECK (public.can_edit_module(auth.uid(), 'cobranca'::public.app_module));
  CREATE POLICY "cobranca delete whatsapp_billing_logs" ON public.whatsapp_billing_logs
    FOR DELETE TO authenticated
    USING (public.can_edit_module(auth.uid(), 'cobranca'::public.app_module));
END $$;
