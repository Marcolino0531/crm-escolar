-- Integração ZapSign — PROVA DE CONCEITO em sandbox (sem validade jurídica).
--
-- Guarda os documentos de teste enviados à ZapSign, seus signatários e todos os
-- callbacks (webhooks) recebidos. Toda linha carrega `ambiente` ('sandbox') e
-- `poc = true` para nunca se misturar com documentos reais quando a integração
-- for para produção: a tela filtra por isso e o status final vem sempre do
-- último callback/consulta, nunca de suposição local.
--
-- Escrita só pelo servidor (service role): o token da API vive na Vercel e não
-- passa pelo navegador. Leitura pela permissão do módulo Documentos.

CREATE TABLE IF NOT EXISTS public.zapsign_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente text NOT NULL DEFAULT 'sandbox',
  poc boolean NOT NULL DEFAULT true,
  origem text NOT NULL CHECK (origem IN ('pdf', 'template')),
  nome text NOT NULL,
  unidade text,
  zapsign_token text UNIQUE,
  zapsign_open_id bigint,
  external_id text,
  status text NOT NULL DEFAULT 'pending',
  template_token text,
  signatarios jsonb NOT NULL DEFAULT '[]'::jsonb,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  assinado_em timestamptz,
  ultima_atualizacao_em timestamptz,
  erro text,
  resposta_criacao jsonb,
  created_by uuid,
  created_by_nome text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zapsign_documentos_enviado_idx
  ON public.zapsign_documentos (enviado_em DESC);

CREATE TABLE IF NOT EXISTS public.zapsign_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid REFERENCES public.zapsign_documentos (id) ON DELETE SET NULL,
  zapsign_token text,
  event_type text NOT NULL DEFAULT '',
  status_documento text,
  sandbox boolean,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payload_hash)
);

CREATE INDEX IF NOT EXISTS zapsign_eventos_token_idx
  ON public.zapsign_eventos (zapsign_token, recebido_em DESC);

-- Webhooks registrados na conta ZapSign (um por ambiente/URL), para a tela
-- saber se o callback já está apontando para o School Hub.
CREATE TABLE IF NOT EXISTS public.zapsign_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente text NOT NULL DEFAULT 'sandbox',
  zapsign_id bigint,
  url text NOT NULL,
  tipo text NOT NULL DEFAULT '',
  resposta jsonb,
  created_by_nome text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.zapsign_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zapsign_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zapsign_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zapsign_documentos read" ON public.zapsign_documentos;
CREATE POLICY "zapsign_documentos read" ON public.zapsign_documentos
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'documentos'::public.app_module));

DROP POLICY IF EXISTS "zapsign_eventos read" ON public.zapsign_eventos;
CREATE POLICY "zapsign_eventos read" ON public.zapsign_eventos
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'documentos'::public.app_module));

DROP POLICY IF EXISTS "zapsign_webhooks read" ON public.zapsign_webhooks;
CREATE POLICY "zapsign_webhooks read" ON public.zapsign_webhooks
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'documentos'::public.app_module));
