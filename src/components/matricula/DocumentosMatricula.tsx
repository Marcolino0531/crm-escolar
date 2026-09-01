// Etapa 4 do formulário público de matrícula: "Documentos".
//
// O arquivo NÃO passa pelo servidor da aplicação: o servidor só emite uma URL de
// upload assinada (bucket privado `matricula-documentos`) e o navegador envia o
// arquivo direto para o Storage. O formulário guarda apenas o caminho — nunca
// uma URL pública — e o painel interno abre os arquivos por link assinado.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileCheck2, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  BUCKET_DOCUMENTOS_MATRICULA,
  DOCUMENTOS_MATRICULA,
  TAMANHO_MAX_DOCUMENTO,
  TIPOS_DOCUMENTO_ACEITOS,
  type DocumentoChave,
  type DocumentosForm,
  type ErrosForm,
} from "@/lib/matricula-form";
import { urlUploadDocumentoMatricula } from "@/lib/matricula-publica.functions";

const ACEITOS = TIPOS_DOCUMENTO_ACEITOS.join(",");

function tamanhoLegivel(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DocumentosMatricula({
  documentos,
  erros,
  onChange,
}: {
  documentos: DocumentosForm;
  erros: ErrosForm;
  onChange: (d: DocumentosForm) => void;
}) {
  const urlUploadFn = useServerFn(urlUploadDocumentoMatricula);
  const [enviando, setEnviando] = useState<DocumentoChave | null>(null);
  const [falhas, setFalhas] = useState<Partial<Record<DocumentoChave, string>>>({});

  const anexar = async (chave: DocumentoChave, arquivo: File) => {
    setFalhas((atual) => ({ ...atual, [chave]: undefined }));

    if (!TIPOS_DOCUMENTO_ACEITOS.includes(arquivo.type)) {
      setFalhas((atual) => ({ ...atual, [chave]: "Envie uma imagem (JPG/PNG) ou um PDF." }));
      return;
    }
    if (arquivo.size > TAMANHO_MAX_DOCUMENTO) {
      setFalhas((atual) => ({ ...atual, [chave]: "Arquivo muito grande (limite de 10 MB)." }));
      return;
    }

    setEnviando(chave);
    try {
      const permissao = await urlUploadFn({ data: { documento: chave, tipo: arquivo.type } });
      if (!permissao.ok || !permissao.path || !permissao.token) {
        setFalhas((atual) => ({
          ...atual,
          [chave]: permissao.erro ?? "Não foi possível enviar o arquivo agora.",
        }));
        return;
      }

      const { error } = await supabase.storage
        .from(BUCKET_DOCUMENTOS_MATRICULA)
        .uploadToSignedUrl(permissao.path, permissao.token, arquivo);
      if (error) {
        setFalhas((atual) => ({
          ...atual,
          [chave]: "Não foi possível enviar o arquivo agora. Tente novamente.",
        }));
        return;
      }

      onChange({
        ...documentos,
        [chave]: {
          path: permissao.path,
          nome: arquivo.name,
          tipo: arquivo.type,
          tamanho: arquivo.size,
        },
      });
    } finally {
      setEnviando(null);
    }
  };

  return (
    <section className="space-y-5 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Documentos</h2>
        <p className="text-xs text-muted-foreground">
          Envie uma foto legível ou o PDF de cada documento.
        </p>
      </div>

      {DOCUMENTOS_MATRICULA.map((documento) => {
        const anexado = documentos[documento.chave];
        return (
          <div key={documento.chave} className="space-y-2 rounded-md border p-3">
            <Label htmlFor={`doc-${documento.chave}`}>{documento.rotulo}</Label>
            {documento.dica && <p className="text-xs text-muted-foreground">{documento.dica}</p>}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={enviando !== null}
                onClick={() => document.getElementById(`doc-${documento.chave}`)?.click()}
              >
                {enviando === documento.chave ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
                {anexado ? "Trocar arquivo" : "Anexar"}
              </Button>
              <input
                id={`doc-${documento.chave}`}
                type="file"
                className="hidden"
                accept={ACEITOS}
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  e.target.value = "";
                  if (arquivo) void anexar(documento.chave, arquivo);
                }}
              />
              {anexado && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-700">
                  <FileCheck2 className="h-4 w-4" />
                  {anexado.nome} ({tamanhoLegivel(anexado.tamanho)})
                </span>
              )}
            </div>

            {falhas[documento.chave] && (
              <p className="text-xs text-destructive">{falhas[documento.chave]}</p>
            )}
            {erros[`documentos.${documento.chave}`] && (
              <p className="text-xs text-destructive">{erros[`documentos.${documento.chave}`]}</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
