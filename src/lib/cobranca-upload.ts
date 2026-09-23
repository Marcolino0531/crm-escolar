// Upload de arquivos do caso de cobrança para o bucket privado (URL assinada
// emitida no servidor; o registro do anexo é feito depois pela server fn).

import { supabase } from "@/integrations/supabase/client";
import { BUCKET_COBRANCA, validarArquivoAnexo } from "@/lib/cobranca-casos";

export interface ArquivoEnviadoCliente {
  path: string;
  nomeArquivo: string;
  tipoArquivo: string;
  tamanhoBytes: number;
}

type AssinarFn = (opts: {
  data: {
    casoId: string;
    arquivo: { nomeArquivo: string; tipoArquivo: string; tamanhoBytes: number };
  };
}) => Promise<{ path: string; token: string }>;

export async function enviarArquivoCobranca(
  assinar: AssinarFn,
  casoId: string,
  arquivo: File | Blob,
  nomeArquivo: string,
): Promise<ArquivoEnviadoCliente> {
  const tipo = arquivo.type || "application/octet-stream";
  const invalido = validarArquivoAnexo(tipo, arquivo.size);
  if (invalido) throw new Error(invalido);
  const permissao = await assinar({
    data: { casoId, arquivo: { nomeArquivo, tipoArquivo: tipo, tamanhoBytes: arquivo.size } },
  });
  const { error } = await supabase.storage
    .from(BUCKET_COBRANCA)
    .uploadToSignedUrl(permissao.path, permissao.token, arquivo, { contentType: tipo });
  if (error) throw new Error("Não foi possível enviar o arquivo agora. Tente novamente.");
  return { path: permissao.path, nomeArquivo, tipoArquivo: tipo, tamanhoBytes: arquivo.size };
}
