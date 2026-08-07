-- Suporte a mensagens de imagem recebidas no Atendimento (WhatsApp).
--
-- As imagens são baixadas da Meta no recebimento do webhook e armazenadas no
-- bucket privado `whatsapp-media` do próprio School Hub. A mensagem passa a
-- guardar o TIPO, o CAMINHO do objeto no storage, o mime e o media_id da Meta
-- (para eventual reprocessamento). A leitura no cliente usa signed URL.

-- Campos de mídia na mensagem.
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_mime text,
  ADD COLUMN IF NOT EXISTS media_id text;

-- Bucket privado para as imagens recebidas.
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', false)
ON CONFLICT (id) DO NOTHING;

-- Leitura das imagens gerando signed URL no cliente: exige Visualizar em
-- Atendimento. O upload é feito no servidor (service role, ignora RLS).
DROP POLICY IF EXISTS "whatsapp media read" ON storage.objects;
CREATE POLICY "whatsapp media read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'whatsapp-media'
    AND public.can_view_module(auth.uid(), 'financeiro_atendimento'::public.app_module)
  );

NOTIFY pgrst, 'reload schema';
