import { useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Eye, ExternalLink, FileSignature, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSchool } from "@/lib/app-context";
import { unidadeDaSelecao } from "@/lib/esportes-unidades";
import { formatarBRL } from "@/lib/rematricula";
import {
  gerarEnviarContratoMatricula,
  listarContratosMatricula,
  previaContratoMatricula,
  registrarWebhookContratos,
  type ContratoPendente,
} from "@/lib/contrato-matricula.functions";

function abrirPdfBase64(base64: string, nomeArquivo: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const aba = window.open(url, "_blank", "noopener");
  if (!aba) {
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function formatarDataHora(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatarData(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "—";
}

const ZAPSIGN_LABEL: Record<string, string> = {
  pending: "Aguardando assinatura",
  signed: "Assinado",
  refused: "Recusado",
  expired: "Expirado",
};

function StatusContrato({ item }: { item: ContratoPendente }) {
  const c = item.contrato;
  if (!c) return <Badge className="bg-slate-100 text-slate-700">Pendente de contrato</Badge>;
  if (c.status === "gerando") return <Badge className="bg-blue-100 text-blue-800">Gerando…</Badge>;
  if (c.status === "erro") {
    return (
      <div className="space-y-1">
        <Badge className="bg-red-100 text-red-800">Erro na geração</Badge>
        <p className="max-w-xs text-xs text-red-700">{c.erro}</p>
      </div>
    );
  }
  const z = c.zapsign;
  const assinado = z?.status === "signed";
  return (
    <div className="space-y-1">
      <Badge
        className={assinado ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}
      >
        {z ? (ZAPSIGN_LABEL[z.status] ?? z.status) : "Contrato enviado"}
      </Badge>
      <p className="text-xs text-muted-foreground">
        {c.numero} · enviado {formatarDataHora(c.enviadoEm)}
        {c.enviadoPor ? ` por ${c.enviadoPor}` : ""}
      </p>
      {assinado && z?.assinadoEm && (
        <p className="text-xs text-muted-foreground">
          Assinado em {formatarDataHora(z.assinadoEm)}
        </p>
      )}
    </div>
  );
}

export function ContratosMatricula({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { schools, selected } = useSchool();
  const listar = useServerFn(listarContratosMatricula);
  const gerar = useServerFn(gerarEnviarContratoMatricula);
  const previa = useServerFn(previaContratoMatricula);
  const registrarWebhook = useServerFn(registrarWebhookContratos);
  const [busca, setBusca] = useState("");
  const [gerandoChave, setGerandoChave] = useState<string | null>(null);
  const [previaChave, setPreviaChave] = useState<string | null>(null);

  const unidadeAtiva = useMemo(() => unidadeDaSelecao(selected, schools), [selected, schools]);
  const unidades = useMemo(
    () => (unidadeAtiva ? [unidadeAtiva] : schools.map((s) => s.name)),
    [unidadeAtiva, schools],
  );

  const consultas = useQueries({
    queries: unidades.map((unidade) => ({
      queryKey: ["contratos_matricula", unidade],
      queryFn: async () => listar({ data: { unidade } }),
      refetchInterval: 60_000,
    })),
  });
  const carregando = consultas.some((c) => c.isLoading);
  const erros = consultas
    .map((c) => c.data?.error ?? (c.error instanceof Error ? c.error.message : null))
    .filter((e): e is string => Boolean(e))
    .join(" · ");
  const carregadas = consultas.filter((c) => c.data);
  const producaoConfigurada = carregadas.every((c) => c.data?.producaoConfigurada);
  // Só afirma "não registrado" com resposta do servidor em mãos: uma consulta
  // que falhou não pode ser lida como ausência de webhook.
  const webhookRegistrado =
    carregadas.length === 0 || carregadas.some((c) => c.data?.webhookProducaoRegistrado);

  const itens = useMemo(() => {
    const todos = consultas.flatMap((c) => c.data?.itens ?? []);
    const q = busca.trim().toLowerCase();
    const filtrados = q
      ? todos.filter(
          (i) =>
            i.alunoNome.toLowerCase().includes(q) ||
            i.alunoId.includes(q) ||
            (i.contrato?.responsavelNome ?? "").toLowerCase().includes(q),
        )
      : todos;
    // Pendentes e com erro primeiro; enviados por último, mais recentes no topo.
    const peso = (i: ContratoPendente) =>
      !i.contrato ? 0 : i.contrato.status === "erro" ? 1 : i.contrato.status === "gerando" ? 2 : 3;
    return [...filtrados].sort(
      (a, b) => peso(a) - peso(b) || b.enviadaEm.localeCompare(a.enviadaEm),
    );
  }, [consultas, busca]);

  const pendentes = itens.filter((i) => !i.contrato || i.contrato.status === "erro").length;
  const enviados = itens.filter((i) => i.contrato?.status === "enviado").length;
  const assinados = itens.filter((i) => i.contrato?.zapsign?.status === "signed").length;

  const gerarMutation = useMutation({
    mutationFn: async (item: ContratoPendente) => {
      setGerandoChave(`${item.unidade}|${item.alunoId}|${item.anoLetivo}`);
      return gerar({
        data: { unidade: item.unidade, alunoId: item.alunoId, anoLetivo: item.anoLetivo },
      });
    },
    onSuccess: (res) => {
      if (res.ok) toast.success(`Contrato ${res.numero} enviado para assinatura.`);
      else toast.error(res.erro ?? "Falha ao gerar o contrato.", { duration: 12000 });
      void qc.invalidateQueries({ queryKey: ["contratos_matricula"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setGerandoChave(null),
  });

  // Só renderiza o PDF: nada vai para a ZapSign nem para o banco.
  const previaMutation = useMutation({
    mutationFn: async (item: ContratoPendente) => {
      setPreviaChave(`${item.unidade}|${item.alunoId}|${item.anoLetivo}`);
      return previa({
        data: { unidade: item.unidade, alunoId: item.alunoId, anoLetivo: item.anoLetivo },
      });
    },
    onSuccess: (res) => {
      if (res.ok && res.pdfBase64) {
        abrirPdfBase64(res.pdfBase64, res.nomeArquivo ?? `previa-${res.numero}.pdf`);
      } else toast.error(res.erro ?? "Falha ao gerar a prévia.", { duration: 12000 });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setPreviaChave(null),
  });

  const webhookMutation = useMutation({
    mutationFn: async () => registrarWebhook(),
    onSuccess: (res) => {
      if (res.ok && res.jaExistia) toast.info("O webhook de produção já estava registrado.");
      else if (res.ok) toast.success("Webhook de produção registrado na ZapSign.");
      else toast.error(res.erro ?? "Falha ao registrar o webhook.");
      void qc.invalidateQueries({ queryKey: ["contratos_matricula"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Pendentes de contrato</p>
          <p className="text-2xl font-semibold">{pendentes}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Contratos enviados</p>
          <p className="text-2xl font-semibold">{enviados}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Assinados</p>
          <p className="text-2xl font-semibold">{assinados}</p>
        </div>
      </div>

      {!carregando && !producaoConfigurada && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4" />
          ZAPSIGN_PROD_TOKEN não está configurada no servidor: os contratos não podem ser enviados.
        </div>
      )}
      {!carregando && producaoConfigurada && !webhookRegistrado && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />O webhook de produção da ZapSign ainda não foi
            registrado: o status de assinatura não será atualizado automaticamente.
          </span>
          {podeEditar && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => webhookMutation.mutate()}
              disabled={webhookMutation.isPending}
            >
              {webhookMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar webhook
            </Button>
          )}
        </div>
      )}
      {erros && <p className="text-sm text-red-600">{erros}</p>}

      <Input
        placeholder="Buscar por aluno, AlunoID ou responsável…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="max-w-sm"
      />

      {carregando ? (
        <Skeleton className="h-64 w-full" />
      ) : itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma matrícula finalizada no portal para as unidades selecionadas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aluno</TableHead>
                <TableHead>Responsável financeiro</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Mensalidade</TableHead>
                <TableHead>Matrícula</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((item) => {
                const chave = `${item.unidade}|${item.alunoId}|${item.anoLetivo}`;
                const gerando = gerandoChave === chave;
                const enviado = item.contrato?.status === "enviado";
                return (
                  <TableRow key={chave}>
                    <TableCell>
                      <p className="font-medium">{item.alunoNome || `AlunoID ${item.alunoId}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.serie || "—"} · {item.anoLetivo} · finalizada{" "}
                        {formatarDataHora(item.enviadaEm)}
                      </p>
                    </TableCell>
                    <TableCell>
                      {item.contrato?.responsavelNome ? (
                        <>
                          <p>{item.contrato.responsavelNome}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.contrato.responsavelEmail}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Lido do Sponte ao gerar
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{item.unidade}</TableCell>
                    <TableCell>
                      {item.contrato?.mensalidadeComDesconto ? (
                        `R$ ${item.contrato.mensalidadeComDesconto}`
                      ) : (
                        <span className="text-xs text-muted-foreground">Vigente no Sponte</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.matricula ? (
                        <>
                          <p>{formatarBRL(item.matricula.valor)}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.matricula.parcelas}x · 1ª em{" "}
                            {formatarData(item.matricula.primeiroVencimento)}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-red-600">Sem parcelamento gravado</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.material ? (
                        <>
                          <p>{formatarBRL(item.material.valorAnual)}</p>
                          <p className="text-xs text-muted-foreground">{item.material.parcelas}x</p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem material</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusContrato item={item} />
                    </TableCell>
                    <TableCell className="text-right">
                      {enviado ? (
                        item.contrato?.zapsign?.signUrl ? (
                          <Button asChild size="sm" variant="ghost">
                            <a
                              href={item.contrato.zapsign.signUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink className="mr-1 h-4 w-4" /> Link de assinatura
                            </a>
                          </Button>
                        ) : null
                      ) : (
                        podeEditar && (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => previaMutation.mutate(item)}
                              disabled={previaMutation.isPending || !item.matricula}
                            >
                              {previaChave === chave ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Eye className="mr-2 h-4 w-4" />
                              )}
                              Gerar prévia
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => gerarMutation.mutate(item)}
                              disabled={
                                gerarMutation.isPending || !producaoConfigurada || !item.matricula
                              }
                            >
                              {gerando ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <FileSignature className="mr-2 h-4 w-4" />
                              )}
                              Gerar e enviar contrato
                            </Button>
                          </div>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
