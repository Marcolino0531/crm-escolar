-- Arquivamento de conversas do Atendimento (estilo WhatsApp).
--
-- `archived` separa as conversas entre as abas "Gerais" (false) e "Arquivadas"
-- (true). Arquivar é só organização visual: nenhuma mensagem é apagada. Quando
-- o responsável envia uma nova mensagem, o webhook põe `archived = false` de
-- volta (desarquiva automaticamente). Coluna aditiva, default false.

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- Índice parcial para listar rapidamente as conversas ativas (aba padrão).
CREATE INDEX IF NOT EXISTS whatsapp_conversations_active_idx
  ON public.whatsapp_conversations (last_message_at DESC NULLS LAST)
  WHERE archived = false;

NOTIFY pgrst, 'reload schema';
