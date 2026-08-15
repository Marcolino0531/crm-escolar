-- Envio de mídia (imagem, PDF e áudio) pelo Atendimento.
--
-- O arquivo escolhido pelo operador é subido do navegador direto para o bucket
-- privado `whatsapp-media`, sob o prefixo "saida/", e o servidor apenas lê esse
-- objeto (service role), sobe para a Meta e envia. Isso evita trafegar o binário
-- pela função serverless, cujo teto de corpo é menor que o limite de mídia da
-- Cloud API.
--
-- A escrita fica restrita a quem tem Editar em Atendimento e ao prefixo de
-- saída: a mídia recebida continua sendo gravada só pelo servidor.

DROP POLICY IF EXISTS "whatsapp media insert saida" ON storage.objects;
CREATE POLICY "whatsapp media insert saida"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-media'
    AND name LIKE 'saida/%'
    AND public.can_edit_module(auth.uid(), 'financeiro_atendimento'::public.app_module)
  );

NOTIFY pgrst, 'reload schema';
