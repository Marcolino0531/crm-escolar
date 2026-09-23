-- ZapSign: cópia própria do PDF assinado.
--
-- O link `signed_file` devolvido pela ZapSign (webhook e GET /docs/{token}/) é
-- uma URL pré-assinada do S3 com validade de ~60 minutos. O School Hub passa a
-- baixar o PDF no servidor assim que o documento fica "signed" e a guardá-lo no
-- bucket privado `zapsign-assinados`, em `<ambiente>/<zapsign_documentos.id>.pdf`.
-- A leitura é só por link assinado emitido pelo servidor (sem policy em
-- storage.objects); escrita só pelo service role.

ALTER TABLE public.zapsign_documentos
  ADD COLUMN IF NOT EXISTS arquivo_assinado_path text,
  ADD COLUMN IF NOT EXISTS arquivo_assinado_em timestamptz,
  ADD COLUMN IF NOT EXISTS arquivo_assinado_erro text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('zapsign-assinados', 'zapsign-assinados', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
