// Aba "ZapSign (teste)" do módulo Documentos — prova de conceito em SANDBOX.
// Tudo o que sai daqui é documento de teste, sem validade jurídica. Nenhum
// Termo de Confissão ou Contrato real é gerado nesta tela.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  FileText,
  FlaskConical,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUnidadeAtiva } from "@/components/SelecioneUnidade";
import { usePermissions } from "@/lib/app-context";
import { pdfParaBase64 } from "@/lib/documento-pdf";
import {
  criarDocumentoTestePdf,
  criarDocumentoTesteTemplate,
  criarTemplateTeste,
  listarDocumentosTeste,
  registrarWebhookTeste,
  sincronizarDocumentoTeste,
  type ZapSignDocumentoLista,
} from "@/lib/zapsign.functions";

type SignatarioForm = { nome: string; email: string; telefone: string; cpf: string };

const signatarioVazio = (): SignatarioForm => ({ nome: "", email: "", telefone: "", cpf: "" });

const STATUS_LABEL: Record<string, { rotulo: string; classe: string }> = {
  pending: { rotulo: "Aguardando assinatura", classe: "bg-amber-100 text-amber-800" },
  signed: { rotulo: "Assinado", classe: "bg-emerald-100 text-emerald-800" },
  refused: { rotulo: "Recusado", classe: "bg-red-100 text-red-800" },
  erro: { rotulo: "Erro na criação", classe: "bg-red-100 text-red-800" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { rotulo: status, classe: "bg-muted text-foreground" };
  return <Badge className={`${s.classe} hover:${s.classe}`}>{s.rotulo}</Badge>;
}

function dataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

async function arquivoParaBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function gerarPdfTeste(nomeSignatarios: string[]): Promise<string> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Documento de teste School Hub", 105, 60, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    "Prova de conceito da integração com a ZapSign (ambiente sandbox). Sem validade jurídica.",
    105,
    72,
    { align: "center", maxWidth: 170 },
  );
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 105, 84, { align: "center" });
  doc.text(`Signatário(s): ${nomeSignatarios.join(", ")}`, 105, 92, {
    align: "center",
    maxWidth: 170,
  });
  return pdfParaBase64(doc);
}

function copiar(texto: string) {
  void navigator.clipboard.writeText(texto).then(() => toast.success("Link copiado"));
}

export function ZapSignSandbox() {
  const unidade = useUnidadeAtiva();
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("documentos");
  const qc = useQueryClient();
  const listar = useServerFn(listarDocumentosTeste);

  const lista = useQuery({
    queryKey: ["zapsign-poc", unidade],
    queryFn: () => listar({ data: { unidade } }),
    refetchInterval: 15_000,
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["zapsign-poc"] });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold">Prova de conceito — ZapSign SANDBOX</p>
          <p>
            Documentos de teste, sem validade jurídica. Nenhum Termo de Confissão de Dívida ou
            Contrato de Matrícula real é gerado ou enviado por esta tela.
            {lista.data && !lista.data.configurado && (
              <strong className="block mt-1">
                ZAPSIGN_SANDBOX_TOKEN não está configurada neste ambiente — criação desativada.
              </strong>
            )}
          </p>
        </div>
      </div>

      {podeEditar && (
        <div className="grid gap-4 lg:grid-cols-2">
          <CriarViaPdf unidade={unidade} onCriado={invalidar} />
          <div className="space-y-4">
            <CriarViaTemplate unidade={unidade} onCriado={invalidar} />
            <RegistrarWebhook webhooks={lista.data?.webhooks ?? []} onRegistrado={invalidar} />
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> Documentos de teste enviados
            {unidade && <Badge variant="outline">{unidade}</Badge>}
          </CardTitle>
          <CardDescription>
            Status atualizado pelo webhook da ZapSign; o botão de sincronizar consulta a API caso o
            callback ainda não tenha chegado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lista.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (lista.data?.documentos.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento de teste ainda.</p>
          ) : (
            <TabelaDocumentos
              documentos={lista.data?.documentos ?? []}
              podeEditar={podeEditar}
              onSincronizado={invalidar}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4" /> Eventos recebidos (webhook)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(lista.data?.eventos.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum callback recebido ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recebido em</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Status do documento</TableHead>
                  <TableHead>Documento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.data?.eventos.map((e) => {
                  const doc = lista.data?.documentos.find((d) => d.id === e.documento_id);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap">{dataHora(e.recebido_em)}</TableCell>
                      <TableCell>
                        <code className="text-xs">{e.event_type || "(sem event_type)"}</code>
                      </TableCell>
                      <TableCell>{e.status_documento ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {doc?.nome ?? e.zapsign_token ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CamposSignatario({
  s,
  onChange,
  onRemove,
  podeRemover,
}: {
  s: SignatarioForm;
  onChange: (s: SignatarioForm) => void;
  onRemove?: () => void;
  podeRemover: boolean;
}) {
  return (
    <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
      <div className="sm:col-span-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Signatário</span>
        {podeRemover && onRemove && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div>
        <Label className="text-xs">Nome *</Label>
        <Input value={s.nome} onChange={(e) => onChange({ ...s, nome: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Email</Label>
        <Input
          type="email"
          value={s.email}
          onChange={(e) => onChange({ ...s, email: e.target.value })}
        />
      </div>
      <div>
        <Label className="text-xs">Telefone (WhatsApp)</Label>
        <Input
          value={s.telefone}
          placeholder="(31) 99999-9999"
          onChange={(e) => onChange({ ...s, telefone: e.target.value })}
        />
      </div>
      <div>
        <Label className="text-xs">CPF</Label>
        <Input
          value={s.cpf}
          placeholder="000.000.000-00"
          onChange={(e) => onChange({ ...s, cpf: e.target.value })}
        />
      </div>
    </div>
  );
}

function mostrarLinks(links: { nome: string; signUrl: string }[]) {
  toast.success("Documento criado na ZapSign sandbox", {
    description: `${links.length} link(s) de assinatura disponível(is) na tabela abaixo.`,
  });
}

function CriarViaPdf({ unidade, onCriado }: { unidade: string | null; onCriado: () => void }) {
  const criar = useServerFn(criarDocumentoTestePdf);
  const [nome, setNome] = useState("Documento de teste School Hub");
  const [signatarios, setSignatarios] = useState<SignatarioForm[]>([signatarioVazio()]);
  const [ordem, setOrdem] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);

  const mut = useMutation({
    mutationFn: async (fonte: "gerado" | "arquivo") => {
      const validos = signatarios.filter((s) => s.nome.trim());
      if (!validos.length) throw new Error("Informe ao menos um signatário.");
      const pdfBase64 =
        fonte === "arquivo"
          ? await arquivoParaBase64(arquivo as File)
          : await gerarPdfTeste(validos.map((s) => s.nome.trim()));
      return criar({
        data: { nome, unidade, pdfBase64, signatarios: validos, ordemSequencial: ordem },
      });
    },
    onSuccess: (r) => {
      mostrarLinks(r.links);
      onCriado();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao criar documento"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Caminho 1 — Upload de PDF pronto</CardTitle>
        <CardDescription>
          Gera um PDF de uma página (&quot;Documento de teste School Hub&quot;) ou usa um PDF do
          computador e cria o documento na sandbox. Sem envio automático de email/WhatsApp: o link é
          copiado desta tela.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Nome do documento</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        {signatarios.map((s, i) => (
          <CamposSignatario
            key={i}
            s={s}
            podeRemover={signatarios.length > 1}
            onChange={(n) => setSignatarios(signatarios.map((x, j) => (j === i ? n : x)))}
            onRemove={() => setSignatarios(signatarios.filter((_, j) => j !== i))}
          />
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={signatarios.length >= 5}
            onClick={() => setSignatarios([...signatarios, signatarioVazio()])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Signatário
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={ordem} onCheckedChange={(v) => setOrdem(v === true)} />
            Assinatura em ordem sequencial
          </label>
        </div>
        <div>
          <Label className="text-xs">PDF do computador (opcional, até 10 MB)</Label>
          <Input
            type="file"
            accept="application/pdf"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={mut.isPending} onClick={() => mut.mutate("gerado")}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Gerar PDF de teste e enviar
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={mut.isPending || !arquivo}
            onClick={() => mut.mutate("arquivo")}
          >
            Enviar PDF selecionado
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CriarViaTemplate({ unidade, onCriado }: { unidade: string | null; onCriado: () => void }) {
  const criarTemplate = useServerFn(criarTemplateTeste);
  const criarDoc = useServerFn(criarDocumentoTesteTemplate);
  const [docx, setDocx] = useState<File | null>(null);
  const [templateToken, setTemplateToken] = useState("");
  const [variaveis, setVariaveis] = useState<string[]>([]);
  const [nome, setNome] = useState("Modelo de teste School Hub");
  const [signatario, setSignatario] = useState<SignatarioForm>(signatarioVazio());
  const [campos, setCampos] = useState<{ de: string; para: string }[]>([
    { de: "{{NOME}}", para: "" },
    { de: "{{DATA}}", para: "" },
  ]);

  const subir = useMutation({
    mutationFn: async () => {
      const docxBase64 = await arquivoParaBase64(docx as File);
      return criarTemplate({ data: { nome, docxBase64 } });
    },
    onSuccess: (r) => {
      setTemplateToken(r.token);
      setVariaveis(r.variaveis);
      if (r.variaveis.length) setCampos(r.variaveis.map((v) => ({ de: v, para: "" })));
      toast.success("Modelo criado na sandbox", {
        description: r.variaveis.length
          ? `Variáveis detectadas: ${r.variaveis.join(", ")}`
          : "A ZapSign não devolveu variáveis detectadas.",
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao criar modelo"),
  });

  const criar = useMutation({
    mutationFn: () =>
      criarDoc({
        data: {
          nome,
          unidade,
          templateToken: templateToken.trim(),
          signatario,
          campos: campos.filter((c) => c.de.trim()),
        },
      }),
    onSuccess: (r) => {
      mostrarLinks(r.links);
      onCriado();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao criar documento"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Caminho 2 — Modelo DOCX com campos dinâmicos</CardTitle>
        <CardDescription>
          Sobe um .docx simples com marcadores (ex.: <code>{"{{NOME}}"}</code>) como modelo na
          sandbox e cria um documento preenchendo os campos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Nome</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Arquivo .docx do modelo</Label>
            <Input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setDocx(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!docx || subir.isPending}
            onClick={() => subir.mutate()}
          >
            {subir.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar modelo
          </Button>
        </div>
        <div>
          <Label className="text-xs">Token do modelo (template_id)</Label>
          <Input
            value={templateToken}
            placeholder="cole aqui ou crie acima"
            onChange={(e) => setTemplateToken(e.target.value)}
          />
          {variaveis.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Variáveis detectadas pela ZapSign: {variaveis.join(", ")}
            </p>
          )}
        </div>
        <CamposSignatario s={signatario} onChange={setSignatario} podeRemover={false} />
        <div className="space-y-2">
          <Label className="text-xs">Campos dinâmicos (de → para)</Label>
          {campos.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input
                className="w-2/5 font-mono text-xs"
                value={c.de}
                onChange={(e) =>
                  setCampos(campos.map((x, j) => (j === i ? { ...x, de: e.target.value } : x)))
                }
              />
              <Input
                value={c.para}
                onChange={(e) =>
                  setCampos(campos.map((x, j) => (j === i ? { ...x, para: e.target.value } : x)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setCampos(campos.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCampos([...campos, { de: "", para: "" }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Campo
          </Button>
        </div>
        <Button
          type="button"
          disabled={!templateToken.trim() || !signatario.nome.trim() || criar.isPending}
          onClick={() => criar.mutate()}
        >
          {criar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Criar documento pelo modelo
        </Button>
      </CardContent>
    </Card>
  );
}

function RegistrarWebhook({
  webhooks,
  onRegistrado,
}: {
  webhooks: { id: string; url: string; tipo: string; created_at: string }[];
  onRegistrado: () => void;
}) {
  const registrar = useServerFn(registrarWebhookTeste);
  const mut = useMutation({
    mutationFn: () => registrar({ data: { baseUrl: window.location.origin } }),
    onSuccess: (r) => {
      toast.success("Webhook registrado na ZapSign sandbox", { description: r.url });
      onRegistrado();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao registrar webhook"),
  });
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Webhook className="h-4 w-4" /> Webhook
        </CardTitle>
        <CardDescription>
          Registra na ZapSign a URL{" "}
          <code>{`${typeof window !== "undefined" ? window.location.origin : ""}/api/zapsign/webhook`}</code>{" "}
          para todos os eventos, protegida por header secreto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {webhooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum webhook registrado ainda.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {webhooks.map((w) => (
              <li key={w.id} className="flex flex-wrap gap-2">
                <span className="font-mono">{w.url}</span>
                <span className="text-muted-foreground">
                  {w.tipo || "todos"} · {dataHora(w.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Registrar webhook desta URL
        </Button>
      </CardContent>
    </Card>
  );
}

function TabelaDocumentos({
  documentos,
  podeEditar,
  onSincronizado,
}: {
  documentos: ZapSignDocumentoLista[];
  podeEditar: boolean;
  onSincronizado: () => void;
}) {
  const sincronizar = useServerFn(sincronizarDocumentoTeste);
  const mut = useMutation({
    mutationFn: (id: string) => sincronizar({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Status na ZapSign: ${r.status}`);
      onSincronizado();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao sincronizar"),
  });

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Documento</TableHead>
            <TableHead>Signatário(s)</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Enviado em</TableHead>
            <TableHead>Assinado em</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documentos.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <div className="font-medium">{d.nome}</div>
                <div className="text-xs text-muted-foreground">
                  {d.origem === "pdf" ? "Upload PDF" : "Modelo DOCX"}
                  {d.unidade ? ` · ${d.unidade}` : ""} · {d.created_by_nome}
                </div>
                {d.erro && <div className="text-xs text-red-600">{d.erro}</div>}
              </TableCell>
              <TableCell>
                <ul className="space-y-1">
                  {d.signatarios.map((s, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center gap-1">
                        <span>{s.nome}</span>
                        <span className="text-xs text-muted-foreground">({s.status})</span>
                        {s.sign_url && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title="Copiar link de assinatura"
                              onClick={() => copiar(s.sign_url as string)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <a
                              href={s.sign_url}
                              target="_blank"
                              rel="noreferrer"
                              title="Abrir link de assinatura"
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </>
                        )}
                      </div>
                      {(s.email || s.telefone) && (
                        <div className="text-xs text-muted-foreground">
                          {[s.email, s.telefone].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </TableCell>
              <TableCell>
                <StatusBadge status={d.status} />
              </TableCell>
              <TableCell className="whitespace-nowrap">{dataHora(d.enviado_em)}</TableCell>
              <TableCell className="whitespace-nowrap">{dataHora(d.assinado_em)}</TableCell>
              <TableCell className="text-right">
                {podeEditar && d.zapsign_token && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={mut.isPending}
                    onClick={() => mut.mutate(d.id)}
                    title="Consultar status na ZapSign"
                  >
                    <RefreshCw className={`h-4 w-4 ${mut.isPending ? "animate-spin" : ""}`} />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
