-- Suporte a mensagens de documento (PDF e genéricos) recebidas no Atendimento.
--
-- Reaproveita o mesmo fluxo já usado para imagens (download da Meta no webhook
-- + bucket privado `whatsapp-media`). Acrescenta o nome original do arquivo
-- (filename) enviado pelo WhatsApp, para exibir no card do documento.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_filename text;

NOTIFY pgrst, 'reload schema';
