import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Gavel,
  HandCoins,
  History,
  Loader2,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { usePermissions, useSchool } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { SelecioneUnidade, useUnidadeAtiva } from "@/components/SelecioneUnidade";
import { AjudaTooltip } from "@/components/diario/AjudaTooltip";
import { HistoricoEnvios } from "@/components/cobranca/HistoricoEnvios";
import { RegistrarEnvioNotificacao } from "@/components/cobranca/NotificacaoExtrajudicial";
import { SecaoProcesso, useProcessoCaso } from "@/components/cobranca/Processo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CHECKLIST_DOCUMENTACAO,
  ETAPAS_FILTRO,
  LABEL_CATEGORIA,
  MOTIVOS_ENCERRAMENTO,
  NOTA_REGRA_CALCULO,
  TIPOS_ANEXO_ACEITOS,
  TOTAL_MENSAGENS,
  dataEnvioSugerida,
  diasRestantesPrazo,
  enderecoResponsavelLinha,
  etapaDoCaso,
  formatarBRL,
  formatarCpf,
  ANO_LETIVO_MINIMO_CONTRATO,
  formatarDataBR,
  labelEtapa,
  montarTimeline,
  podeAlterarDataInicio,
  podeCorrigirDataEnvio,
  podeSubstituirPrint,
  proximaAcao,
  validarDataEnvio,
  validarDataEnvioCorrigida,
  validarDataInicio,
  validarEncerramento,
  validarRegistroMensagem,
  type CategoriaAnexo,
  type DemonstrativoDebito,
  type EtapaCaso,
} from "@/lib/cobranca-casos";
import {
  alterarDataInicioCobranca,
  assinarUploadCobranca,
  carregarCasoCobranca,
  anexarContratosAssinadosCobranca,
  contratosAssinadosDoCasoCobranca,
  copiarDocumentosMatricula,
  debitoAtualCaso,
  documentosMatriculaDoCaso,
  encerrarCobranca,
  iniciarCobranca,
  listarCasosCobranca,
  marcarDocumentacaoCobranca,
  prepararCobranca,
  registrarAnexoCobranca,
  registrarMensagemCobranca,
  substituirPrintMensagem,
  removerAnexoCobranca,
  type CasoDetalhe,
  type CasoLista,
  type MensagemComLink,
  type PreviaCobranca,
} from "@/lib/cobranca-casos.functions";
import {
  baixarBytes,
  gerarDossie,
  gerarPdfDemonstrativo,
  nomeArquivoSeguro,
} from "@/lib/cobranca-casos-pdf";
import {
  eventosProcesso,
  labelTipoAndamento,
  labelTipoRecebimento,
  mesclarTimeline,
} from "@/lib/cobranca-processos";
import type { ProcessoDetalhe } from "@/lib/cobranca-processos.functions";
import { enviarArquivoCobranca } from "@/lib/cobranca-upload";
import { carregarLogoDoColegio, paraColegioRecibo, useColegios } from "@/lib/colegios";
import { buscarAlunosSponte, type AlunoBuscaSponte } from "@/lib/sponte.functions";
import { displayPhoneBR } from "@/lib/phone";

// A unidade NÃO vem pela URL: a tela segue o seletor global do topo. Abrir um
// caso de outra unidade troca o seletor (ver CasoView).
interface CobrancaSearch {
  caso?: string;
}

export const Route = createFileRoute("/cobranca")({
  head: () => ({ meta: [{ title: "Cobrança — School Hub" }] }),
  validateSearch: (s: Record<string, unknown>): CobrancaSearch => ({
    caso: typeof s.caso === "string" && s.caso ? s.caso : undefined,
  }),
  component: CobrancaGate,
});

// VISIBILIDADE (DEFAULT DENY + cadeia): a rota é bloqueada por padrão. Só
// renderiza quando o Administrador concede acesso à macro "financeiro" E ao
// submódulo "financeiro_cobranca".
function CobrancaGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro") || !canView("financeiro_cobranca"))
    return <AccessDenied message="Você não tem permissão para acessar a Cobrança." />;
  return <CobrancaPage />;
}

const ACCEPT_ANEXO = TIPOS_ANEXO_ACEITOS.join(",");

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function CobrancaPage() {
  const search = Route.useSearch();
  const [aba, setAba] = useState<string>("cobrancas");
  useEffect(() => {
    if (search.caso) setAba("cobrancas");
  }, [search.caso]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <HandCoins className="h-6 w-6 text-primary" /> Cobrança
          <AjudaTooltip
            rotulo="Sobre esta tela"
            texto="Régua manual de cobrança por responsável financeiro: 5 mensagens em dias úteis, notificação extrajudicial, documentação para o processo e dossiê. Nada aqui envia mensagem automaticamente."
          />
        </h1>
        <p className="text-sm text-muted-foreground">
          Cobrança iniciada por responsável, com registro de cada etapa e prints como comprovação.
        </p>
      </div>

      <Tabs value={aba} onValueChange={setAba} className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="cobrancas">
            <HandCoins className="mr-2 h-4 w-4" /> Cobranças
          </TabsTrigger>
          <TabsTrigger value="historico">
            <History className="mr-2 h-4 w-4" /> Histórico de Envios
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cobrancas">
          <AbaCobrancas casoInicial={search.caso} />
        </TabsContent>

        <TabsContent value="historico">
          <HistoricoEnvios />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Cobranças: lista de casos da unidade do topo + iniciar cobrança ───────────

function AbaCobrancas({ casoInicial }: { casoInicial?: string }) {
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("financeiro_cobranca");
  // Unidade do seletor global; `null` = consolidado das unidades permitidas.
  const unidade = useUnidadeAtiva();
  const listar = useServerFn(listarCasosCobranca);
  const [filtro, setFiltro] = useState<EtapaCaso | "todas">("todas");
  const [casoAberto, setCasoAberto] = useState<string | null>(casoInicial ?? null);
  useEffect(() => {
    if (casoInicial) setCasoAberto(casoInicial);
  }, [casoInicial]);
  const [iniciando, setIniciando] = useState(false);

  const casos = useQuery({
    queryKey: ["cobranca_casos", unidade ?? "todas"],
    queryFn: () => listar({ data: { unidade } }),
  });

  const lista = useMemo(() => {
    const todos = casos.data ?? [];
    const filtrados =
      filtro === "todas"
        ? todos.filter((c) => c.status !== "encerrado")
        : todos.filter((c) => etapaDoCaso(c, c.hojeYMD) === filtro);
    // Cards com print de hoje pendente primeiro, mantendo a ordem dentro de cada grupo.
    return [
      ...filtrados.filter((c) => c.printPendenteOrdem !== null),
      ...filtrados.filter((c) => c.printPendenteOrdem === null),
    ];
  }, [casos.data, filtro]);

  if (casoAberto) {
    return (
      <CasoView casoId={casoAberto} podeEditar={podeEditar} onVoltar={() => setCasoAberto(null)} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Etapa</Label>
          <Select value={filtro} onValueChange={(v) => setFiltro(v as EtapaCaso | "todas")}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas em andamento</SelectItem>
              {ETAPAS_FILTRO.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {podeEditar && unidade && (
          <Button onClick={() => setIniciando(true)}>
            <Plus className="mr-2 h-4 w-4" /> Iniciar cobrança
          </Button>
        )}
      </div>

      {podeEditar && !unidade && <SelecioneUnidade acao="Iniciar uma cobrança" />}

      {casos.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {mensagemErro(casos.error)}
        </div>
      )}

      {casos.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-3 text-sm font-medium">Nenhuma cobrança nesta etapa.</p>
          <p className="text-xs text-muted-foreground">
            Use &quot;Iniciar cobrança&quot; para abrir um caso a partir de um aluno.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((c) => (
            <CasoCard
              key={c.id}
              caso={c}
              mostrarUnidade={!unidade}
              onAbrir={() => setCasoAberto(c.id)}
            />
          ))}
        </div>
      )}

      {iniciando && unidade && (
        <IniciarCobrancaDialog
          unidade={unidade}
          onClose={() => setIniciando(false)}
          onAbrirCaso={(id) => {
            setIniciando(false);
            setCasoAberto(id);
          }}
        />
      )}
    </div>
  );
}

function EtapaBadge({ etapa }: { etapa: EtapaCaso }) {
  const cls: Record<EtapaCaso, string> = {
    mensagens: "bg-sky-100 text-sky-700",
    notificacao: "bg-amber-100 text-amber-700",
    aguardando_prazo: "bg-orange-100 text-orange-700",
    pronto_processo: "bg-red-100 text-red-700",
    processo: "bg-purple-100 text-purple-700",
    encerrado: "bg-slate-100 text-slate-600",
  };
  return <Badge className={`${cls[etapa]} hover:${cls[etapa]}`}>{labelEtapa(etapa)}</Badge>;
}

function PrintPendenteBadge({ ordem }: { ordem: number }) {
  return (
    <Badge
      className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100"
      title={`Mensagem ${ordem} prevista para hoje sem print registrado`}
    >
      <AlertTriangle className="h-3 w-3" /> Print de hoje pendente
    </Badge>
  );
}

function CasoCard({
  caso,
  mostrarUnidade,
  onAbrir,
}: {
  caso: CasoLista;
  mostrarUnidade: boolean;
  onAbrir: () => void;
}) {
  const etapa = etapaDoCaso(caso, caso.hojeYMD);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/50 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold leading-tight">{caso.responsavel_nome}</p>
          <p className="text-xs text-muted-foreground">
            {formatarCpf(caso.responsavel_cpf) || "CPF não informado"}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <EtapaBadge etapa={etapa} />
          {caso.printPendenteOrdem !== null && (
            <PrintPendenteBadge ordem={caso.printPendenteOrdem} />
          )}
        </div>
      </div>
      {mostrarUnidade && (
        <Badge variant="outline" className="w-fit text-[11px]">
          {caso.unidade}
        </Badge>
      )}
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" /> {caso.alunos.map((a) => a.nome).join(", ")}
      </p>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Valor inicial</span>
        <span className="font-semibold">{formatarBRL(caso.valor_inicial)}</span>
      </div>
      <p className="text-xs text-muted-foreground">Início {formatarDataBR(caso.data_inicio)}</p>
      <p className="rounded-md bg-muted px-2 py-1 text-xs">
        <span className="font-medium">Próxima ação:</span>{" "}
        {proximaAcao(caso, caso.mensagens, caso.hojeYMD)}
      </p>
    </button>
  );
}

// ─── Iniciar cobrança ────────────────────────────────────────────────────────

function IniciarCobrancaDialog({
  unidade,
  onClose,
  onAbrirCaso,
}: {
  unidade: string;
  onClose: () => void;
  onAbrirCaso: (id: string) => void;
}) {
  const qc = useQueryClient();
  const buscar = useServerFn(buscarAlunosSponte);
  const preparar = useServerFn(prepararCobranca);
  const iniciar = useServerFn(iniciarCobranca);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [alunoId, setAlunoId] = useState<string | null>(null);
  const hoje = hojeYMD();
  const [dataInicio, setDataInicio] = useState(hoje);
  const dataInvalida = validarDataInicio(dataInicio, hoje);

  const busca = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: termo.trim(), unidade } });
      if (r.error) throw new Error(r.error);
      return r.alunos;
    },
    onSuccess: (alunos) => setResultados(alunos),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const previa = useQuery({
    queryKey: ["cobranca_previa", unidade, alunoId, dataInicio],
    queryFn: () => preparar({ data: { unidade, alunoId: alunoId!, dataInicio } }),
    enabled: !!alunoId && !dataInvalida,
    retry: false,
  });

  const confirmar = useMutation({
    mutationFn: () => iniciar({ data: { unidade, alunoId: alunoId!, dataInicio } }),
    onSuccess: ({ casoId }) => {
      toast.success("Cobrança iniciada.");
      void qc.invalidateQueries({ queryKey: ["cobranca_casos"] });
      onAbrirCaso(casoId);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const p = previa.data;
  const semVencidas = !!p && p.demonstrativo.parcelas.length === 0;
  const podeIniciar =
    !!p && !semVencidas && !p.casoAtivoId && !dataInvalida && !confirmar.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Iniciar cobrança — {unidade}</DialogTitle>
          <DialogDescription>
            Busque o aluno; o caso é aberto para o responsável financeiro dele, reunindo todos os
            alunos desse responsável na unidade.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (termo.trim().length >= 3) busca.mutate();
          }}
        >
          <Input
            placeholder="Nome do aluno (mín. 3 letras)"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
          <Button type="submit" disabled={busca.isPending || termo.trim().length < 3}>
            {busca.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </form>

        <div className="space-y-1">
          <Label htmlFor="cobranca-data-inicio">Data de início da cobrança</Label>
          <Input
            id="cobranca-data-inicio"
            type="date"
            required
            max={hoje}
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-fit"
          />
          {dataInvalida ? (
            <p className="text-xs text-red-600">{dataInvalida}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Data-base do débito e da 1ª mensagem. Pode ser alterada até o primeiro print.
            </p>
          )}
        </div>

        {resultados && !alunoId && (
          <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
            {resultados.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhum aluno encontrado.</p>
            ) : (
              resultados.map((a) => (
                <button
                  key={a.alunoId}
                  type="button"
                  onClick={() => setAlunoId(a.alunoId)}
                  className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-muted"
                >
                  <span>
                    {a.nome}
                    <span className="ml-2 text-xs text-muted-foreground">{a.turma}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{a.situacao}</span>
                </button>
              ))
            )}
          </div>
        )}

        {alunoId && previa.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {alunoId && previa.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {mensagemErro(previa.error)}
            <Button
              variant="link"
              size="sm"
              className="ml-2 h-auto p-0"
              onClick={() => setAlunoId(null)}
            >
              escolher outro aluno
            </Button>
          </div>
        )}
        {p && (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm sm:grid-cols-2">
              <Info label="Responsável" valor={p.responsavel.nome} />
              <Info label="CPF" valor={formatarCpf(p.responsavel.cpf) || "—"} />
              <Info label="Telefone" valor={displayPhoneBR(p.responsavel.telefone) || "—"} />
              <Info label="Alunos" valor={p.alunos.map((a) => a.nome).join(", ")} />
            </div>
            {p.indisponivel && (
              <Aviso>
                O Sponte não respondeu para algum aluno; as parcelas podem estar incompletas.
              </Aviso>
            )}
            <TabelaDemonstrativo demonstrativo={p.demonstrativo} />
            {semVencidas && (
              <Aviso>Não há parcela vencida: a cobrança não pode ser iniciada.</Aviso>
            )}
            {p.casoAtivoId && (
              <Aviso>
                Já existe cobrança ativa para este responsável nesta unidade.{" "}
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => onAbrirCaso(p.casoAtivoId!)}
                >
                  Abrir a existente
                </Button>
              </Aviso>
            )}
            {!semVencidas && !p.casoAtivoId && (
              <p className="text-xs text-muted-foreground">
                Mensagens previstas para: {p.datasPrevistas.map(formatarDataBR).join(", ")}.
              </p>
            )}
            <Button variant="ghost" size="sm" onClick={() => setAlunoId(null)}>
              Escolher outro aluno
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!podeIniciar} onClick={() => confirmar.mutate()}>
            {confirmar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar e iniciar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{valor}</p>
    </div>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function TabelaDemonstrativo({ demonstrativo }: { demonstrativo: DemonstrativoDebito }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Aluno</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead className="text-right">Original</TableHead>
            <TableHead className="text-right">Multa</TableHead>
            <TableHead className="text-right">Juros</TableHead>
            <TableHead className="text-right">Atualizado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {demonstrativo.parcelas.map((p, i) => (
            <TableRow key={i}>
              <TableCell className="text-xs">{p.aluno}</TableCell>
              <TableCell className="text-xs">{p.descricao}</TableCell>
              <TableCell className="text-xs">{formatarDataBR(p.vencimento)}</TableCell>
              <TableCell className="text-right text-xs">{formatarBRL(p.original)}</TableCell>
              <TableCell className="text-right text-xs">{formatarBRL(p.multa)}</TableCell>
              <TableCell className="text-right text-xs">{formatarBRL(p.juros)}</TableCell>
              <TableCell className="text-right text-xs font-medium">
                {formatarBRL(p.atualizado)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={6} className="text-right text-sm font-semibold">
              Total em {formatarDataBR(demonstrativo.dataBase)}
            </TableCell>
            <TableCell className="text-right text-sm font-semibold">
              {formatarBRL(demonstrativo.total)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Tela do caso ────────────────────────────────────────────────────────────

function CasoView({
  casoId,
  podeEditar,
  onVoltar,
}: {
  casoId: string;
  podeEditar: boolean;
  onVoltar: () => void;
}) {
  const qc = useQueryClient();
  const carregar = useServerFn(carregarCasoCobranca);
  const detalhe = useQuery({
    queryKey: ["cobranca_caso", casoId],
    queryFn: () => carregar({ data: { casoId } }),
  });
  const processoQ = useProcessoCaso(casoId);
  // Caso de outra unidade (link do sino ou parâmetro da URL): o seletor global
  // acompanha o caso, para que topo e tela mostrem a mesma unidade.
  const { selected, schools, setSelected } = useSchool();
  const unidadeCaso = detalhe.data?.caso.unidade;
  const sincronizado = useRef(false);
  useEffect(() => {
    if (!unidadeCaso || sincronizado.current) return;
    sincronizado.current = true;
    const alvo = schools.find((s) => s.name === unidadeCaso);
    if (alvo && selected !== alvo.id) setSelected(alvo.id);
  }, [unidadeCaso, schools, selected, setSelected]);
  // Depois disso, trocar o topo para OUTRA unidade fecha o caso (a tela volta
  // a mostrar só o que o seletor indica).
  const unidadeTopo = useUnidadeAtiva();
  const alinhado = useRef(false);
  useEffect(() => {
    if (!unidadeCaso) return;
    if (unidadeTopo === unidadeCaso) {
      alinhado.current = true;
      return;
    }
    if (alinhado.current && unidadeTopo) onVoltar();
  }, [unidadeTopo, unidadeCaso, onVoltar]);
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["cobranca_caso", casoId] });
    void qc.invalidateQueries({ queryKey: ["cobranca_casos"] });
    void qc.invalidateQueries({ queryKey: ["cobranca_processo", casoId] });
  };

  if (detalhe.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (detalhe.error || !detalhe.data) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onVoltar}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {mensagemErro(detalhe.error ?? "Caso não encontrado.")}
        </div>
      </div>
    );
  }

  const d = detalhe.data;
  const { caso, mensagens, anexos } = d;
  const etapa = etapaDoCaso(caso, d.hojeYMD);
  const encerrado = caso.status === "encerrado";
  const edita = podeEditar && !encerrado;
  const proc = processoQ.data;
  const timeline = mesclarTimeline(
    montarTimeline(caso, mensagens, anexos, d.hojeYMD),
    proc ? eventosProcesso(proc.processo, proc.andamentos, proc.recebimentos, d.hojeYMD) : [],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onVoltar}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar à lista
        </Button>
        <div className="flex flex-wrap gap-2">
          <BotaoDossie detalhe={d} etapa={etapa} processo={proc ?? null} />
          {edita && <EncerrarDialog casoId={casoId} onDone={recarregar} />}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{caso.responsavel_nome}</h2>
            <p className="text-sm text-muted-foreground">
              {formatarCpf(caso.responsavel_cpf) || "CPF não informado"}
              {caso.responsavel_telefone ? ` · ${displayPhoneBR(caso.responsavel_telefone)}` : ""}
              {caso.responsavel_email ? ` · ${caso.responsavel_email}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {enderecoResponsavelLinha(caso.responsavel_endereco)}
            </p>
          </div>
          <EtapaBadge etapa={etapa} />
        </div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
          <Info label="Unidade" valor={caso.unidade} />
          <Info label="Alunos" valor={caso.alunos.map((a) => a.nome).join(", ")} />
          <Info label="Valor inicial" valor={formatarBRL(caso.valor_inicial)} />
          <div>
            <Info label="Início" valor={formatarDataBR(caso.data_inicio)} />
            {edita && podeAlterarDataInicio(caso, mensagens) && (
              <AlterarDataInicioDialog
                casoId={caso.id}
                dataAtual={caso.data_inicio}
                hoje={d.hojeYMD}
                onDone={recarregar}
              />
            )}
          </div>
        </div>
        {!encerrado && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
            <span className="font-medium">Próxima ação:</span>{" "}
            {proximaAcao(caso, mensagens, d.hojeYMD)}
          </p>
        )}
        {encerrado && (
          <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
            Encerrada em {caso.encerrado_em ? formatarDataHora(caso.encerrado_em) : "—"} — motivo:{" "}
            {MOTIVOS_ENCERRAMENTO.find((m) => m.id === caso.motivo_encerramento)?.label ?? "—"}
            {caso.observacao_encerramento ? ` · ${caso.observacao_encerramento}` : ""}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {caso.status === "mensagens" && (
            <SecaoMensagens detalhe={d} edita={edita} onDone={recarregar} />
          )}
          {(caso.status === "notificacao" || caso.status === "aguardando_prazo") && (
            <SecaoNotificacao detalhe={d} etapa={etapa} edita={edita} onDone={recarregar} />
          )}
          {(etapa === "pronto_processo" || caso.status === "processo" || encerrado) && (
            <SecaoProcesso
              caso={caso}
              prontoParaProcesso={etapa === "pronto_processo"}
              edita={edita}
              onDone={recarregar}
            />
          )}
          {caso.status !== "mensagens" && (
            <SecaoDocumentacao detalhe={d} edita={edita} onDone={recarregar} />
          )}
          {encerrado && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 font-semibold">Anexos</h3>
              <ListaAnexos anexos={anexos} edita={false} onDone={recarregar} />
            </section>
          )}
        </div>
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <Clock className="h-4 w-4" /> Linha do tempo
          </h3>
          <ol className="space-y-3 border-l border-border pl-4">
            {timeline.map((ev, i) => (
              <li key={i} className="relative text-sm">
                <span
                  className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${
                    ev.futuro ? "border border-muted-foreground bg-card" : "bg-primary"
                  }`}
                />
                <p className={`font-medium ${ev.futuro ? "text-muted-foreground" : ""}`}>
                  {ev.titulo}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ev.quando.length > 10 ? formatarDataHora(ev.quando) : formatarDataBR(ev.quando)}
                  {ev.detalhe ? ` · ${ev.detalhe}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

// ─── Upload genérico ─────────────────────────────────────────────────────────

function BotaoArquivo({
  label,
  onFile,
  disabled,
  pending,
  variant = "outline",
}: {
  label: string;
  onFile: (f: File) => void;
  disabled?: boolean;
  pending?: boolean;
  variant?: "outline" | "default" | "secondary";
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT_ANEXO}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <Button
        size="sm"
        variant={variant}
        disabled={disabled || pending}
        onClick={() => ref.current?.click()}
      >
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="mr-2 h-4 w-4" />
        )}
        {label}
      </Button>
    </>
  );
}

// ─── Etapa Mensagens ─────────────────────────────────────────────────────────

function SecaoMensagens({
  detalhe,
  edita,
  onDone,
}: {
  detalhe: CasoDetalhe;
  edita: boolean;
  onDone: () => void;
}) {
  const [registrando, setRegistrando] = useState<MensagemComLink | null>(null);
  const [substituindo, setSubstituindo] = useState<MensagemComLink | null>(null);
  const mensagens = [...detalhe.mensagens].sort((a, b) => a.ordem - b.ordem);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-1 flex items-center gap-2 font-semibold">
        <MessageCircle className="h-4 w-4" /> Mensagens (
        {mensagens.filter((m) => m.enviada_em).length}/{TOTAL_MENSAGENS})
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        O texto é livre e enviado fora do sistema. Registrar o envio exige a data do envio e o print
        da conversa.
      </p>
      {registrando && (
        <RegistrarEnvioDialog
          detalhe={detalhe}
          mensagem={registrando}
          anterior={mensagens.find((m) => m.ordem === registrando.ordem - 1) ?? null}
          onClose={() => setRegistrando(null)}
          onDone={() => {
            setRegistrando(null);
            onDone();
          }}
        />
      )}
      {substituindo && (
        <SubstituirPrintDialog
          detalhe={detalhe}
          mensagem={substituindo}
          anterior={mensagens.find((m) => m.ordem === substituindo.ordem - 1) ?? null}
          seguinte={mensagens.find((m) => m.ordem === substituindo.ordem + 1) ?? null}
          onClose={() => setSubstituindo(null)}
          onDone={() => {
            setSubstituindo(null);
            onDone();
          }}
        />
      )}
      <ul className="divide-y divide-border">
        {mensagens.map((m) => {
          const bloqueio = validarRegistroMensagem(mensagens, m.ordem, true);
          const doDia = detalhe.printPendenteOrdem === m.ordem;
          return (
            <li
              key={m.id}
              className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${
                doDia ? "-mx-2 rounded-md bg-amber-50 px-2 dark:bg-amber-950/30" : ""
              }`}
            >
              <div>
                <p className="font-medium">
                  Mensagem {m.ordem} · prevista para {formatarDataBR(m.data_prevista)}
                  {doDia && (
                    <span className="ml-2 inline-flex">
                      <PrintPendenteBadge ordem={m.ordem} />
                    </span>
                  )}
                </p>
                {m.enviada_em ? (
                  <p className="text-xs text-muted-foreground">
                    Enviada em {formatarDataBR(m.data_envio ?? m.enviada_em.slice(0, 10))}
                    <span className="ml-1 text-[11px]">
                      (registrado {formatarDataHora(m.enviada_em)})
                    </span>
                    {m.fora_da_data && (
                      <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700">
                        enviada fora da data prevista
                      </Badge>
                    )}
                    {m.print_url && (
                      <a
                        href={m.print_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 underline"
                      >
                        ver print
                      </a>
                    )}
                    {edita && podeSubstituirPrint(detalhe.caso, m) && (
                      <button
                        type="button"
                        className="ml-2 underline"
                        disabled={!!substituindo || !!registrando}
                        onClick={() => setSubstituindo(m)}
                      >
                        Substituir print
                      </button>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Pendente</p>
                )}
              </div>
              {edita && !m.enviada_em && (
                <Button
                  size="sm"
                  disabled={!!bloqueio || !!registrando}
                  onClick={() => setRegistrando(m)}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Registrar envio
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RegistrarEnvioDialog({
  detalhe,
  mensagem,
  anterior,
  onClose,
  onDone,
}: {
  detalhe: CasoDetalhe;
  mensagem: MensagemComLink;
  anterior: MensagemComLink | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const assinar = useServerFn(assinarUploadCobranca);
  const registrar = useServerFn(registrarMensagemCobranca);
  const hoje = detalhe.hojeYMD;
  const [dataEnvio, setDataEnvio] = useState(dataEnvioSugerida(mensagem.data_prevista, hoje));
  const [arquivo, setArquivo] = useState<File | null>(null);
  const invalida = validarDataEnvio(
    dataEnvio,
    hoje,
    detalhe.caso.data_inicio,
    anterior?.data_envio ?? null,
  );
  const foraDaData = !invalida && dataEnvio !== mensagem.data_prevista;

  const enviar = useMutation({
    mutationFn: async () => {
      const print = await enviarArquivoCobranca(assinar, detalhe.caso.id, arquivo!, arquivo!.name);
      return registrar({
        data: { casoId: detalhe.caso.id, ordem: mensagem.ordem, dataEnvio, print },
      });
    },
    onSuccess: () => {
      toast.success("Envio registrado.");
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !enviar.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Registrar envio · Mensagem {mensagem.ordem}/{TOTAL_MENSAGENS}
          </DialogTitle>
          <DialogDescription>
            Prevista para {formatarDataBR(mensagem.data_prevista)}. Informe a data em que a mensagem
            foi realmente enviada e anexe o print da conversa.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="registrar-data-envio">Data do envio</Label>
            <Input
              id="registrar-data-envio"
              type="date"
              required
              min={anterior?.data_envio ?? detalhe.caso.data_inicio}
              max={hoje}
              value={dataEnvio}
              onChange={(e) => setDataEnvio(e.target.value)}
              className="w-fit"
            />
            {invalida ? (
              <p className="text-xs text-red-600">{invalida}</p>
            ) : foraDaData ? (
              <p className="text-xs text-amber-700">
                Será marcada como enviada fora da data prevista.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Print da conversa</Label>
            <div className="flex items-center gap-2">
              <BotaoArquivo
                label={arquivo ? "Trocar print" : "Escolher print"}
                onFile={setArquivo}
                disabled={enviar.isPending}
              />
              {arquivo && (
                <span className="truncate text-xs text-muted-foreground">{arquivo.name}</span>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={enviar.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!!invalida || !arquivo || enviar.isPending}
            onClick={() => enviar.mutate()}
          >
            {enviar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar envio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubstituirPrintDialog({
  detalhe,
  mensagem,
  anterior,
  seguinte,
  onClose,
  onDone,
}: {
  detalhe: CasoDetalhe;
  mensagem: MensagemComLink;
  anterior: MensagemComLink | null;
  seguinte: MensagemComLink | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const assinar = useServerFn(assinarUploadCobranca);
  const substituir = useServerFn(substituirPrintMensagem);
  const hoje = detalhe.hojeYMD;
  const dataAtual = mensagem.data_envio ?? "";
  const podeCorrigir = podeCorrigirDataEnvio(detalhe.caso);
  const [dataEnvio, setDataEnvio] = useState(dataAtual);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const invalida = podeCorrigir
    ? validarDataEnvioCorrigida(
        dataEnvio,
        hoje,
        detalhe.caso.data_inicio,
        anterior?.data_envio ?? null,
        seguinte?.data_envio ?? null,
      )
    : null;
  const dataMudou = podeCorrigir && dataEnvio !== dataAtual;
  const foraDaData = !invalida && podeCorrigir && dataEnvio !== mensagem.data_prevista;

  const enviar = useMutation({
    mutationFn: async () => {
      const print = await enviarArquivoCobranca(assinar, detalhe.caso.id, arquivo!, arquivo!.name);
      return substituir({
        data: {
          casoId: detalhe.caso.id,
          ordem: mensagem.ordem,
          dataEnvio: dataMudou ? dataEnvio : undefined,
          print,
        },
      });
    },
    onSuccess: () => {
      toast.success("Print substituído.");
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !enviar.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Substituir print · Mensagem {mensagem.ordem}/{TOTAL_MENSAGENS}
          </DialogTitle>
          <DialogDescription>
            O print atual será trocado pelo novo arquivo. A substituição fica registrada na linha do
            tempo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="substituir-data-envio">Data do envio</Label>
            <Input
              id="substituir-data-envio"
              type="date"
              readOnly={!podeCorrigir}
              disabled={!podeCorrigir}
              min={anterior?.data_envio ?? detalhe.caso.data_inicio}
              max={seguinte?.data_envio ?? hoje}
              value={dataEnvio}
              onChange={(e) => setDataEnvio(e.target.value)}
              className="w-fit"
            />
            {!podeCorrigir ? (
              <p className="text-xs text-muted-foreground">
                A data não pode ser alterada após a geração da notificação extrajudicial.
              </p>
            ) : invalida ? (
              <p className="text-xs text-red-600">{invalida}</p>
            ) : foraDaData ? (
              <p className="text-xs text-amber-700">
                Será marcada como enviada fora da data prevista.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Novo print da conversa</Label>
            <div className="flex items-center gap-2">
              <BotaoArquivo
                label={arquivo ? "Trocar print" : "Escolher print"}
                onFile={setArquivo}
                disabled={enviar.isPending}
              />
              {arquivo && (
                <span className="truncate text-xs text-muted-foreground">{arquivo.name}</span>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={enviar.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!!invalida || !arquivo || enviar.isPending}
            onClick={() => enviar.mutate()}
          >
            {enviar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Substituir print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Alterar data de início ──────────────────────────────────────────────────

function AlterarDataInicioDialog({
  casoId,
  dataAtual,
  hoje,
  onDone,
}: {
  casoId: string;
  dataAtual: string;
  hoje: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const alterar = useServerFn(alterarDataInicioCobranca);
  const [open, setOpen] = useState(false);
  const [dataInicio, setDataInicio] = useState(dataAtual);
  const invalida = validarDataInicio(dataInicio, hoje);
  const mut = useMutation({
    mutationFn: () => alterar({ data: { casoId, dataInicio } }),
    onSuccess: ({ valorInicial }) => {
      toast.success(`Data de início alterada. Novo valor inicial: ${formatarBRL(valorInicial)}.`);
      void qc.invalidateQueries({ queryKey: ["cobranca_casos"] });
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDataInicio(dataAtual);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="h-auto p-0 text-xs">
          Alterar data de início
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alterar data de início</DialogTitle>
          <DialogDescription>
            As 5 datas previstas, o débito inicial e o valor inicial são recalculados com a nova
            data. Só é possível enquanto nenhuma mensagem tiver print registrado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="alterar-data-inicio">Nova data de início</Label>
          <Input
            id="alterar-data-inicio"
            type="date"
            max={hoje}
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-fit"
          />
          {invalida && <p className="text-xs text-red-600">{invalida}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!!invalida || dataInicio === dataAtual || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Etapa Notificação ───────────────────────────────────────────────────────

function SecaoNotificacao({
  detalhe,
  etapa,
  edita,
  onDone,
}: {
  detalhe: CasoDetalhe;
  etapa: EtapaCaso;
  edita: boolean;
  onDone: () => void;
}) {
  const { caso } = detalhe;
  const restantes = caso.prazo_final ? diasRestantesPrazo(caso.prazo_final, detalhe.hojeYMD) : null;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <Gavel className="h-4 w-4" /> Notificação extrajudicial
      </h3>
      {caso.status === "notificacao" && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {caso.notificacao_gerada_em
              ? `Gerada em ${formatarDataHora(caso.notificacao_gerada_em)}.`
              : "Ainda não gerada."}
          </span>
          {edita && (
            <Button asChild size="sm" variant={caso.notificacao_gerada_em ? "outline" : "default"}>
              <Link to="/documentos" search={{ tipo: "notificacao_extrajudicial", caso: caso.id }}>
                <FileText className="mr-2 h-4 w-4" />
                {caso.notificacao_gerada_em ? "Gerar novamente em Documentos" : "Gerar notificação"}
              </Link>
            </Button>
          )}
        </div>
      )}
      {caso.status === "aguardando_prazo" && caso.prazo_final && (
        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          Recebida em {formatarDataBR(caso.notificacao_recebida_em ?? "")} · prazo final{" "}
          {formatarDataBR(caso.prazo_final)} ·{" "}
          {etapa === "pronto_processo" ? (
            <span className="font-semibold text-red-700">
              prazo encerrado — pronto para processo
            </span>
          ) : (
            <span className="font-semibold">
              {restantes === 0 ? "vence hoje" : `faltam ${restantes} dia(s)`}
            </span>
          )}
        </div>
      )}
      {edita && caso.status === "notificacao" && (
        <RegistrarEnvioNotificacao
          casoId={caso.id}
          status={caso.status}
          prazoFinal={caso.prazo_final}
          onDone={onDone}
        />
      )}
    </section>
  );
}

// ─── Documentação para o processo ────────────────────────────────────────────

function SecaoDocumentacao({
  detalhe,
  edita,
  onDone,
}: {
  detalhe: CasoDetalhe;
  edita: boolean;
  onDone: () => void;
}) {
  const { caso, anexos } = detalhe;
  const assinar = useServerFn(assinarUploadCobranca);
  const registrarAnexo = useServerFn(registrarAnexoCobranca);
  const marcar = useServerFn(marcarDocumentacaoCobranca);
  const [pendente, setPendente] = useState<string | null>(null);
  const [nomeOutro, setNomeOutro] = useState("");

  const upload = useMutation({
    mutationFn: async ({
      categoria,
      arquivo,
      nomePersonalizado,
    }: {
      categoria: CategoriaAnexo;
      arquivo: File;
      nomePersonalizado?: string;
    }) => {
      const enviado = await enviarArquivoCobranca(assinar, caso.id, arquivo, arquivo.name);
      return registrarAnexo({
        data: { casoId: caso.id, categoria, arquivo: enviado, nomePersonalizado, origem: "upload" },
      });
    },
    onSuccess: () => {
      toast.success("Documento anexado.");
      setNomeOutro("");
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
    onSettled: () => setPendente(null),
  });

  const toggle = useMutation({
    mutationFn: (v: { categoria: CategoriaAnexo; concluido: boolean }) =>
      marcar({ data: { casoId: caso.id, ...v } }),
    onSuccess: onDone,
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const itens = CHECKLIST_DOCUMENTACAO.filter(
    (i) => i.categoria !== "notificacao_enviada" && i.categoria !== "print_notificacao",
  );

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-1 flex items-center gap-2 font-semibold">
        <FileText className="h-4 w-4" /> Documentação para o processo
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Nenhum item é obrigatório para avançar. Marque como concluído o que já estiver reunido.
      </p>
      <ul className="divide-y divide-border">
        {itens.map((item) => {
          const doCaso = anexos.filter((a) => a.categoria === item.categoria);
          const concluido = caso.documentacao_concluida.includes(item.categoria);
          return (
            <li key={item.categoria} className="space-y-2 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={concluido}
                    disabled={!edita || toggle.isPending}
                    onCheckedChange={(v) =>
                      toggle.mutate({ categoria: item.categoria, concluido: v === true })
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span
                      className={`font-medium ${concluido ? "line-through text-muted-foreground" : ""}`}
                    >
                      {item.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{item.descricao}</span>
                  </span>
                </label>
                {edita && (
                  <div className="flex flex-wrap items-center gap-2">
                    {item.categoria === "demonstrativo" && (
                      <GerarDemonstrativo detalhe={detalhe} onDone={onDone} />
                    )}
                    {item.categoria === "docs_responsavel" && (
                      <BuscarNoSistema casoId={caso.id} onDone={onDone} />
                    )}
                    {item.categoria === "contrato" && (
                      <BuscarContratoAssinado casoId={caso.id} onDone={onDone} />
                    )}
                    {item.categoria === "outro" && (
                      <Input
                        className="h-8 w-44"
                        placeholder="Nome do documento"
                        value={nomeOutro}
                        onChange={(e) => setNomeOutro(e.target.value)}
                      />
                    )}
                    <BotaoArquivo
                      label="Anexar"
                      pending={pendente === item.categoria}
                      disabled={
                        upload.isPending || (item.categoria === "outro" && !nomeOutro.trim())
                      }
                      onFile={(f) => {
                        setPendente(item.categoria);
                        upload.mutate({
                          categoria: item.categoria,
                          arquivo: f,
                          nomePersonalizado:
                            item.categoria === "outro" ? nomeOutro.trim() : undefined,
                        });
                      }}
                    />
                  </div>
                )}
              </div>
              {doCaso.length > 0 && <ListaAnexos anexos={doCaso} edita={edita} onDone={onDone} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ListaAnexos({
  anexos,
  edita,
  onDone,
}: {
  anexos: CasoDetalhe["anexos"];
  edita: boolean;
  onDone: () => void;
}) {
  const remover = useServerFn(removerAnexoCobranca);
  const rm = useMutation({
    mutationFn: (anexoId: string) => remover({ data: { anexoId } }),
    onSuccess: onDone,
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const ordenados = [...anexos].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <ul className="space-y-1 pl-6">
      {ordenados.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate">
            {a.url ? (
              <a href={a.url} target="_blank" rel="noreferrer" className="underline">
                {a.nome_personalizado || a.nome_arquivo}
              </a>
            ) : (
              a.nome_personalizado || a.nome_arquivo
            )}
            <span className="ml-2 text-muted-foreground">
              {LABEL_CATEGORIA[a.categoria]} · {formatarDataHora(a.created_at)}
              {a.origem !== "upload" ? ` · ${a.origem}` : ""}
            </span>
          </span>
          {edita && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              disabled={rm.isPending}
              onClick={() => {
                if (confirm("Remover este anexo?")) rm.mutate(a.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function GerarDemonstrativo({ detalhe, onDone }: { detalhe: CasoDetalhe; onDone: () => void }) {
  const { caso } = detalhe;
  const debito = useServerFn(debitoAtualCaso);
  const assinar = useServerFn(assinarUploadCobranca);
  const registrarAnexo = useServerFn(registrarAnexoCobranca);
  const { data: colegios = [] } = useColegios();
  const [aberto, setAberto] = useState(false);
  const [dataBase, setDataBase] = useState(hojeYMD());

  const gerar = useMutation({
    mutationFn: async () => {
      const row = colegios.find((c) => c.unidade === caso.unidade);
      if (!row)
        throw new Error("Preencha os dados da unidade em Configurações → Dados dos Colégios.");
      const atual = await debito({ data: { casoId: caso.id, dataBase } });
      if (atual.indisponivel)
        throw new Error("Sponte indisponível para algum aluno; tente novamente.");
      if (atual.demonstrativo.parcelas.length === 0)
        throw new Error("Não há parcela vencida em aberto na data-base informada.");
      const logo = await carregarLogoDoColegio(row.logo_path ?? null);
      const doc = await gerarPdfDemonstrativo(
        {
          colegio: paraColegioRecibo(row),
          responsavel: {
            nome: caso.responsavel_nome,
            cpf: caso.responsavel_cpf,
            telefone: caso.responsavel_telefone,
            endereco: caso.responsavel_endereco,
          },
          alunos: caso.alunos,
          demonstrativo: atual.demonstrativo,
        },
        logo,
      );
      const bytes = new Uint8Array(doc.output("arraybuffer"));
      const nome = `${nomeArquivoSeguro(`demonstrativo-${caso.responsavel_nome}-${dataBase}`)}.pdf`;
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const enviado = await enviarArquivoCobranca(assinar, caso.id, blob, nome);
      await registrarAnexo({
        data: {
          casoId: caso.id,
          categoria: "demonstrativo",
          arquivo: enviado,
          origem: "gerado",
          nomePersonalizado: `Demonstrativo em ${formatarDataBR(dataBase)} — total ${formatarBRL(atual.demonstrativo.total)}`,
        },
      });
      baixarBytes(bytes, nome);
    },
    onSuccess: () => {
      toast.success("Demonstrativo gerado e anexado.");
      setAberto(false);
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
        <FileText className="mr-2 h-4 w-4" /> Gerar demonstrativo
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gerar demonstrativo do débito</DialogTitle>
            <DialogDescription>
              Busca as parcelas em aberto atuais no Sponte de todos os alunos do caso e aplica a
              regra oficial na data-base. {NOTA_REGRA_CALCULO}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">Data-base</Label>
            <Input type="date" value={dataBase} onChange={(e) => setDataBase(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={gerar.isPending || !dataBase} onClick={() => gerar.mutate()}>
              {gerar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Gerar e anexar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BuscarNoSistema({ casoId, onDone }: { casoId: string; onDone: () => void }) {
  const listar = useServerFn(documentosMatriculaDoCaso);
  const copiar = useServerFn(copiarDocumentosMatricula);
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const docs = useQuery({
    queryKey: ["cobranca_docs_matricula", casoId],
    queryFn: () => listar({ data: { casoId } }),
    enabled: aberto,
  });

  const cp = useMutation({
    mutationFn: () => copiar({ data: { casoId, documentoIds: [...sel] } }),
    onSuccess: ({ copiados }) => {
      toast.success(`${copiados} documento(s) copiado(s) para o caso.`);
      setAberto(false);
      setSel(new Set());
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
        <Search className="mr-2 h-4 w-4" /> Buscar no sistema
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Documentos enviados na matrícula</DialogTitle>
            <DialogDescription>
              Arquivos de matricula_documentos dos alunos do caso. Os selecionados são copiados para
              o caso com origem &quot;sistema&quot;.
            </DialogDescription>
          </DialogHeader>
          {docs.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : docs.error ? (
            <p className="text-sm text-red-700">{mensagemErro(docs.error)}</p>
          ) : (docs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum documento de matrícula encontrado.
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {docs.data!.map((doc) => (
                <li key={doc.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={sel.has(doc.id)}
                      onCheckedChange={(v) => {
                        const n = new Set(sel);
                        if (v === true) n.add(doc.id);
                        else n.delete(doc.id);
                        setSel(n);
                      }}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">{doc.documento}</span>
                      <span className="block text-xs text-muted-foreground">
                        {doc.alunoNome} · {doc.nomeArquivo}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={sel.size === 0 || cp.isPending} onClick={() => cp.mutate()}>
              {cp.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Copiar selecionados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BuscarContratoAssinado({ casoId, onDone }: { casoId: string; onDone: () => void }) {
  const listar = useServerFn(contratosAssinadosDoCasoCobranca);
  const anexar = useServerFn(anexarContratosAssinadosCobranca);
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const contratos = useQuery({
    queryKey: ["cobranca_contratos_assinados", casoId],
    queryFn: () => listar({ data: { casoId } }),
    enabled: aberto,
  });

  const mut = useMutation({
    mutationFn: () => anexar({ data: { casoId, contratoIds: [...sel] } }),
    onSuccess: ({ anexados, repetidos }) => {
      toast.success(
        `${anexados} contrato(s) anexado(s) ao caso.${repetidos ? ` ${repetidos} já estava(m) anexado(s).` : ""}`,
      );
      setAberto(false);
      setSel(new Set());
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const lista = contratos.data ?? [];
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
        <Search className="mr-2 h-4 w-4" /> Buscar no sistema
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Contratos assinados no sistema</DialogTitle>
            <DialogDescription>
              Contratos de matrícula de {ANO_LETIVO_MINIMO_CONTRATO} em diante, desta unidade e dos
              alunos do caso, assinados na ZapSign. O PDF assinado é copiado para o caso.
            </DialogDescription>
          </DialogHeader>
          {contratos.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : contratos.error ? (
            <p className="text-sm text-red-700">{mensagemErro(contratos.error)}</p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum contrato assinado de {ANO_LETIVO_MINIMO_CONTRATO} em diante encontrado no
              sistema para os alunos deste caso. Use o upload.
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {lista.map((c) => (
                <li key={c.contratoId}>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={sel.has(c.contratoId)}
                      disabled={c.jaAnexado}
                      onCheckedChange={(v) => {
                        const n = new Set(sel);
                        if (v === true) n.add(c.contratoId);
                        else n.delete(c.contratoId);
                        setSel(n);
                      }}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">
                        {c.alunoNome} · {c.anoLetivo}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Nº {c.numeroContrato}
                        {c.assinadoEm &&
                          ` · assinado em ${formatarDataBR(c.assinadoEm.slice(0, 10))}`}
                        {c.jaAnexado && " · já anexado a este caso"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={sel.size === 0 || mut.isPending} onClick={() => mut.mutate()}>
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Anexar selecionados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Encerrar ────────────────────────────────────────────────────────────────

function EncerrarDialog({ casoId, onDone }: { casoId: string; onDone: () => void }) {
  const encerrar = useServerFn(encerrarCobranca);
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const erro = motivo ? validarEncerramento(motivo, observacao) : "Escolha o motivo.";

  const mut = useMutation({
    mutationFn: () => encerrar({ data: { casoId, motivo, observacao: observacao.trim() } }),
    onSuccess: () => {
      toast.success("Cobrança encerrada.");
      setAberto(false);
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <XCircle className="mr-2 h-4 w-4" /> Encerrar cobrança
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Encerrar cobrança</DialogTitle>
            <DialogDescription>O caso passa a ser somente leitura.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Motivo</Label>
              <Select value={motivo} onValueChange={setMotivo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVOS_ENCERRAMENTO.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Observação {motivo === "outro" ? "(obrigatória)" : "(opcional)"}
              </Label>
              <Textarea
                rows={3}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </div>
            {motivo && erro && <p className="text-xs text-red-700">{erro}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!!erro || mut.isPending}
              onClick={() => mut.mutate()}
            >
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Encerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Dossiê ──────────────────────────────────────────────────────────────────

function tipoPorNome(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  return "application/octet-stream";
}

function BotaoDossie({
  detalhe,
  etapa,
  processo,
}: {
  detalhe: CasoDetalhe;
  etapa: EtapaCaso;
  processo: ProcessoDetalhe | null;
}) {
  const { data: colegios = [] } = useColegios();
  const gerar = useMutation({
    mutationFn: async () => {
      const { caso, mensagens, anexos } = detalhe;
      const row = colegios.find((c) => c.unidade === caso.unidade) ?? null;
      const logo = row ? await carregarLogoDoColegio(row.logo_path ?? null) : null;
      const timeline = mesclarTimeline(
        montarTimeline(caso, mensagens, anexos, detalhe.hojeYMD),
        processo
          ? eventosProcesso(
              processo.processo,
              processo.andamentos,
              processo.recebimentos,
              detalhe.hojeYMD,
            )
          : [],
      );
      const anexosProcesso = processo
        ? [
            ...processo.andamentos
              .filter((a) => a.anexo_url && a.anexo_path)
              .map((a) => ({
                titulo: `Andamento ${formatarDataBR(a.data)} — ${labelTipoAndamento(a.tipo)}`,
                url: a.anexo_url!,
                tipo: tipoPorNome(a.anexo_path!),
                quando: a.data,
              })),
            ...processo.recebimentos
              .filter((r) => r.anexo_url && r.anexo_path)
              .map((r) => ({
                titulo: `Recebimento ${formatarDataBR(r.data)} — ${labelTipoRecebimento(r.tipo)} ${formatarBRL(r.valor)}`,
                url: r.anexo_url!,
                tipo: tipoPorNome(r.anexo_path!),
                quando: r.data,
              })),
          ].sort((a, b) => a.quando.localeCompare(b.quando))
        : [];
      const prints = [...mensagens]
        .sort((a, b) => a.ordem - b.ordem)
        .filter((m) => m.print_url && m.print_path)
        .map((m) => ({
          titulo: `Mensagem ${m.ordem} — ${formatarDataBR(m.data_envio ?? m.data_prevista)}`,
          url: m.print_url!,
          tipo: tipoPorNome(m.print_path!),
        }));
      const bytes = await gerarDossie({
        caso,
        etapa,
        timeline,
        anexos: [...anexos].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        prints,
        processo: processo?.processo ?? null,
        andamentos: processo?.andamentos ?? [],
        recebimentos: processo?.recebimentos ?? [],
        anexosProcesso,
        colegio: row ? paraColegioRecibo(row) : null,
        logo,
        geradoEm: hojeYMD(),
      });
      baixarBytes(bytes, `${nomeArquivoSeguro(`dossie-${caso.responsavel_nome}`)}.pdf`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Button variant="outline" size="sm" disabled={gerar.isPending} onClick={() => gerar.mutate()}>
      {gerar.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      Baixar dossiê
    </Button>
  );
}
