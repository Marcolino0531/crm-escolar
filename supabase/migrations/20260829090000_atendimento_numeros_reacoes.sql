-- Atendimento: número da escola por conversa e reação por mensagem.
--
-- A escola opera dois números na Cloud API (CEC/CEC Baby e Núcleo Belvedere/
-- Núcleo Vale do Sereno). O webhook passa a gravar em cada conversa o número
-- que recebeu a mensagem (phone_number_id) e o grupo de unidades a que ele
-- corresponde, para filtrar a lista por unidade e responder pelo mesmo número.
-- Conversas antigas ficam com NULL e são tratadas como do número histórico.

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS phone_number_id text,
  ADD COLUMN IF NOT EXISTS numero_grupo text
    CHECK (numero_grupo IS NULL OR numero_grupo IN ('cec', 'belvedere'));

CREATE INDEX IF NOT EXISTS whatsapp_conversations_numero_grupo_idx
  ON public.whatsapp_conversations (numero_grupo);

-- A unicidade deixa de ser só pelo telefone: o mesmo responsável pode falar com
-- os dois números da escola, e cada lado tem a sua conversa. A chave passa a ser
-- (telefone, número que atende), com a linha antiga (phone_number_id NULL)
-- ocupando o slot vazio — ela é adotada pelo número do grupo dela no primeiro
-- evento, sem duplicar nem fundir históricos.
ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_wa_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_wa_phone_numero_key
  ON public.whatsapp_conversations (wa_phone, coalesce(phone_number_id, ''));

-- Reação (emoji) aplicada à mensagem pelo responsável. NULL = sem reação, que é
-- também o estado depois de a reação ser removida no WhatsApp.
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS reaction_emoji text;

NOTIFY pgrst, 'reload schema';
