// Seção "Documentos" da ficha da matrícula (tela Matrículas / e-Formulário).
//
// Lista todos os documentos do formulário (presentes ou pendentes), com a
// origem de cada um, e deixa a secretaria (Editar no e-Formulário) anexar ou
// substituir arquivos recebidos depois do envio, além de "Anexar outro
// documento" com nome livre. O upload usa o mesmo mecanismo do formulário: o
// servidor emite um link de upload assinado do bucket privado e o navegador
// envia o arquivo direto ao Storage. Excluir: só admin e só anexos da
// secretaria. Todas as permissões são checadas de novo no servidor.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Download,
  Eye,
  FileCheck2,
  FilePlus2,
  History,
  Loader2,
  Paperclip,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET_DOCUMENTOS_MATRICULA, TIPOS_DOCUMENTO_ACEITOS } from "@/lib/matricula-form";
import {
  TAMANHO_MAX_NOME_DOCUMENTO,
  dataCurtaBrasil,
  erroArquivoDocumento,
  montarListaDocumentosFicha,
  origemDocumentoTexto,
  rotuloDocumento,
} from "@/lib/matricula-documentos";
import { tamanhoLegivel } from "@/lib/matricula-detalhe";
import {
  excluirDocumentoSecretaria,
  registrarDocumentoSecretaria,
  urlUploadDocumentoSecretaria,
  type DocumentoHistoricoSubmissao,
  type DocumentoSubmissao,
} from "@/lib/matriculas.functions";

const ACEITOS = TIPOS_DOCUMENTO_ACEITOS.join(",");

type Alvo = { documento: string } | { nomeDocumento: string };

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function DocumentosFicha({
  submissaoId,
  submissionId,
  documentos,
  historico,
  podeAnexar,
  podeExcluir,
}: {
  /** id da linha em enrollment_submissions. */
  submissaoId: string;
  /** submission_id (chave da ficha). */
  submissionId: string;
  documentos: DocumentoSubmissao[];
  historico: DocumentoHistoricoSubmissao[];
  podeAnexar: boolean;
  podeExcluir: boolean;
}) {
  const queryClient = useQueryClient();
  const urlUpload = useServerFn(urlUploadDocumentoSecretaria);
  const registrar = useServerFn(registrarDocumentoSecretaria);
  const excluir = useServerFn(excluirDocumentoSecretaria);

  const [enviando, setEnviando] = useState<string | null>(null);
  const [outroAberto, setOutroAberto] = useState(false);
  const [nomeOutro, setNomeOutro] = useState("");
  const [arquivoOutro, setArquivoOutro] = useState<File | null>(null);
  const [excluindo, setExcluindo] = useState<DocumentoSubmissao | null>(null);
  const [excluirPendente, setExcluirPendente] = useState(false);

  const { padronizados, livres } = montarListaDocumentosFicha(documentos);

  async function recarregar() {
    await queryClient.invalidateQueries({ queryKey: ["matricula-detalhe", submissionId] });
  }

  async function enviar(chaveEnvio: string, alvo: Alvo, arquivo: File): Promise<boolean> {
    const erro = erroArquivoDocumento(arquivo.type, arquivo.size);
    if (erro) {
      toast.error(erro);
      return false;
    }
    setEnviando(chaveEnvio);
    try {
      const permissao = await urlUpload({
        data: { id: submissaoId, tipo: arquivo.type, tamanho: arquivo.size },
      });
      if (!permissao.ok) {
        toast.error(permissao.erro);
        return false;
      }
      const { error } = await supabase.storage
        .from(BUCKET_DOCUMENTOS_MATRICULA)
        .uploadToSignedUrl(permissao.path, permissao.token, arquivo, {
          contentType: arquivo.type,
        });
      if (error) {
        toast.error("Não foi possível enviar o arquivo. Tente novamente.");
        return false;
      }
      const r = await registrar({
        data: { id: submissaoId, path: permissao.path, nomeArquivo: arquivo.name, ...alvo },
      });
      toast.success(
        r.substituido
          ? "Documento substituído. A versão anterior ficou no histórico."
          : "Documento anexado.",
      );
      await recarregar();
      return true;
    } catch (e) {
      toast.error(mensagem(e));
      return false;
    } finally {
      setEnviando(null);
    }
  }

  async function confirmarExclusao() {
    if (!excluindo?.id) return;
    setExcluirPendente(true);
    try {
      await excluir({ data: { documentoId: excluindo.id } });
      toast.success("Documento excluído.");
      setExcluindo(null);
      await recarregar();
    } catch (e) {
      toast.error(mensagem(e));
    } finally {
      setExcluirPendente(false);
    }
  }

  function BotaoArquivo({ chave, alvo, rotulo }: { chave: string; alvo: Alvo; rotulo: string }) {
    const inputId = `ficha-doc-${chave}`;
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={enviando !== null}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          {enviando === chave ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="mr-2 h-3.5 w-3.5" />
          )}
          {rotulo}
        </Button>
        <input
          id={inputId}
          type="file"
          className="hidden"
          accept={ACEITOS}
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = "";
            if (arquivo) void enviar(chave, alvo, arquivo);
          }}
        />
      </>
    );
  }

  function Links({ doc }: { doc: DocumentoSubmissao }) {
    return (
      <>
        {doc.url && (
          <Button asChild variant="outline" size="sm">
            <a href={doc.url} target="_blank" rel="noreferrer">
              <Eye className="mr-2 h-3.5 w-3.5" /> Visualizar
            </a>
          </Button>
        )}
        {(doc.urlDownload ?? doc.url) && (
          <Button asChild variant="outline" size="sm">
            <a href={doc.urlDownload ?? doc.url ?? undefined} download={doc.nomeArquivo}>
              <Download className="mr-2 h-3.5 w-3.5" /> Baixar
            </a>
          </Button>
        )}
      </>
    );
  }

  function LinhaPresente({
    doc,
    rotulo,
    chave,
  }: {
    doc: DocumentoSubmissao;
    rotulo: string;
    chave?: string;
  }) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
          <p className="flex items-center gap-1.5 text-sm">
            <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="font-medium text-emerald-700">Presente</span>
            <span className="break-all text-muted-foreground">
              · {doc.nomeArquivo} · {tamanhoLegivel(doc.tamanhoBytes)}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{origemDocumentoTexto(doc)}</p>
          {doc.url === null && (
            <p className="text-xs text-destructive">Arquivo não encontrado no armazenamento.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Links doc={doc} />
          {podeAnexar && chave !== undefined && (
            <BotaoArquivo chave={chave} alvo={{ documento: chave }} rotulo="Substituir" />
          )}
          {podeExcluir && doc.origem === "secretaria" && doc.id && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setExcluindo(doc)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Documentos
        </h4>
        {podeAnexar && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={enviando !== null}
            onClick={() => {
              setNomeOutro("");
              setArquivoOutro(null);
              setOutroAberto(true);
            }}
          >
            <FilePlus2 className="mr-2 h-3.5 w-3.5" /> Anexar outro documento
          </Button>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        {padronizados.map((item) =>
          item.doc ? (
            <LinhaPresente
              key={item.chave}
              doc={item.doc}
              rotulo={item.rotulo}
              chave={item.chave}
            />
          ) : (
            <div key={item.chave} className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {item.rotulo}
                </p>
                <p className="text-sm font-medium text-amber-700">Pendente</p>
                {item.dica && <p className="text-xs text-muted-foreground">{item.dica}</p>}
              </div>
              {podeAnexar && (
                <BotaoArquivo chave={item.chave} alvo={{ documento: item.chave }} rotulo="Anexar" />
              )}
            </div>
          ),
        )}
        {livres.map((doc) => (
          <LinhaPresente key={doc.id ?? doc.documento} doc={doc} rotulo={rotuloDocumento(doc)} />
        ))}
      </div>

      {historico.length > 0 && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Versões anteriores (substituídas)
          </p>
          {historico.map((doc) => (
            <div key={doc.id} className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {rotuloDocumento(doc)}
                </p>
                <p className="break-all text-sm">
                  {doc.nomeArquivo} · {tamanhoLegivel(doc.tamanhoBytes)}
                </p>
                <p className="text-xs text-muted-foreground">{origemDocumentoTexto(doc)}</p>
                <p className="text-xs text-muted-foreground">
                  Substituído em {dataCurtaBrasil(doc.substituidoEm)}
                  {doc.substituidoPorNome ? ` por ${doc.substituidoPorNome}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Links doc={doc} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={outroAberto} onOpenChange={(v) => enviando === null && setOutroAberto(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Anexar outro documento</DialogTitle>
            <DialogDescription>
              Para arquivos fora da lista do formulário. Foto ou PDF, até 10 MB.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ficha-doc-outro-nome">Nome do documento</Label>
              <Input
                id="ficha-doc-outro-nome"
                value={nomeOutro}
                maxLength={TAMANHO_MAX_NOME_DOCUMENTO}
                placeholder="Ex.: Laudo médico"
                onChange={(e) => setNomeOutro(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ficha-doc-outro-arquivo">Arquivo</Label>
              <Input
                id="ficha-doc-outro-arquivo"
                type="file"
                accept={ACEITOS}
                onChange={(e) => setArquivoOutro(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={enviando !== null}
              onClick={() => setOutroAberto(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={enviando !== null || nomeOutro.trim() === "" || arquivoOutro === null}
              onClick={async () => {
                if (!arquivoOutro) return;
                const ok = await enviar("outro", { nomeDocumento: nomeOutro.trim() }, arquivoOutro);
                if (ok) setOutroAberto(false);
              }}
            >
              {enviando === "outro" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Anexar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={excluindo !== null} onOpenChange={(v) => !v && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir documento anexado?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo
                ? `"${rotuloDocumento(excluindo)}" (${excluindo.nomeArquivo}) será apagado da ficha e do armazenamento. Esta ação não pode ser desfeita.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirPendente}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={excluirPendente}
              onClick={(e) => {
                e.preventDefault();
                void confirmarExclusao();
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
