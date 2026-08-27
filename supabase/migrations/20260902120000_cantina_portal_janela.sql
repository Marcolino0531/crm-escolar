-- Janela sazonal do portal público de recarga da cantina.
--
-- Linha única com o período do ano (MM-DD, sem ano) em que o portal aceita
-- pedidos: fora dele não há boleto do ano para receber a cobrança (dezembro) e
-- não há aula (janeiro). Guardar sem o ano faz o bloqueio valer automaticamente
-- todo ano; as datas ficam editáveis na tela interna da Cantina.
--
-- RLS: leitura para quem vê o módulo 'cantina'; a escrita é feita por server
-- function (service role) depois de checar can_edit_module. O portal público
-- também lê pela service role — o cliente anônimo não tem policy aqui.

CREATE TABLE IF NOT EXISTS public.cantina_portal_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  abertura_mmdd text NOT NULL DEFAULT '02-01',
  fechamento_mmdd text NOT NULL DEFAULT '11-25',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

INSERT INTO public.cantina_portal_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.cantina_portal_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cantina_portal_config_select ON public.cantina_portal_config;
CREATE POLICY cantina_portal_config_select ON public.cantina_portal_config
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'cantina'::public.app_module));
