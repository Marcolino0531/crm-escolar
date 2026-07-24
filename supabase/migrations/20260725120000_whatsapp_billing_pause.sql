-- Cobrança Automática — kill switch ("Pausar Envios") do disparo diário.
--
-- Tabela de linha única (id = 'singleton'). Quando `paused_date` for igual à
-- data (horário de Brasília) em que o cron de cobrança roda, o envio automático
-- daquele dia é bloqueado — contingência para quando o arquivo retorno do banco
-- não pôde ser baixado a tempo. No dia seguinte a trava deixa de valer sozinha.
--
-- RLS espelha o módulo Cobrança: quem pode VER o módulo lê o estado; quem pode
-- EDITAR aciona/desaciona a pausa. O cron (service role) ignora RLS.

CREATE TABLE IF NOT EXISTS public.whatsapp_billing_pause (
  id text PRIMARY KEY DEFAULT 'singleton',
  paused_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT whatsapp_billing_pause_singleton CHECK (id = 'singleton')
);

INSERT INTO public.whatsapp_billing_pause (id) VALUES ('singleton')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.whatsapp_billing_pause ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_billing_pause'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_billing_pause', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "cobranca view whatsapp_billing_pause" ON public.whatsapp_billing_pause
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'cobranca'::public.app_module));

CREATE POLICY "cobranca update whatsapp_billing_pause" ON public.whatsapp_billing_pause
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'cobranca'::public.app_module))
  WITH CHECK (public.can_edit_module(auth.uid(), 'cobranca'::public.app_module));
