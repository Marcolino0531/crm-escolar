import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  Download,
  FileText,
  History,
  Loader2,
  Receipt,
  Search,
  User,
} from "lucide-react";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, usePermissions } from "@/lib/app-context";
import { supabase } from "@/integrations/supabase/client";
import {
  buscarAlunosSponte,
  buscarDadosCadastraisAluno,
  fetchTitulosAlunoSponte,
  type AlunoBuscaSponte,
  type ResponsavelCadastroSponte,
} from "@/lib/sponte.functions";
import { parseBRLNumber } from "@/lib/currency";
import { carregarLogoDoColegio, paraColegioRecibo, UNIDADES, useColegios } from "@/lib/colegios";
import { baixarPdfRecibo, type LogoRecibo } from "@/lib/recibo-pdf";
import { baixarPdfDeclaracao } from "@/lib/declaracao-pdf";
import { baixarPdfDeclaracaoIR } from "@/lib/declaracao-ir-pdf";
import {
  anoIRPadrao,
  anoReferenciaIR,
  anosIRDisponiveis,
  montarDeclaracaoIR,
  pagamentosIR,
  totalPagamentosIR,
  validarDeclaracaoIR,
  type ParcelaIR,
} from "@/lib/imposto-renda";
import {
  exigeConfirmacao,
  montarDeclaracaoDebitos,
  pendenciasEmAberto,
  rotuloTipoDocumento,
  TIPOS_DOCUMENTO,
  validarDeclaracao,
  type PendenciasAluno,
  type ResponsavelDeclaracao,
  type TipoDocumento,
} from "@/lib/declaracoes";
import {
  formatarBRL,
  formatarDataBR,
  itensDoRecibo,
  montarRecibo,
  TOPICOS_RECIBO,
  validarRecibo,
  type AlunoRecibo,
  type ColegioRecibo,
  type ResponsavelRecibo,
} from "@/lib/recibos";

export const Route = createFileRoute("/documentos")({
  head: () => ({ meta: [{ title: "Documentos — School Hub" }] }),
  component: DocumentosGate,
});

function DocumentosGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("documentos"))
    return <AccessDenied message="Você não tem permissão para acessar Documentos." />;
  return <DocumentosPage />;
}

type ReciboSnapshot = {
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsavel: ResponsavelRecibo;
  valores: Record<string, number>;
};

type DeclaracaoSnapshot = {
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsaveis: ResponsavelDeclaracao[];
  pendencias: PendenciasAluno;
};

// Guardamos as parcelas já selecionadas (e não todas as do aluno): reimprimir
// aplica o mesmo filtro sobre o mesmo conjunto e devolve o documento idêntico,
// mesmo que o Sponte mude depois.
type DeclaracaoIRSnapshot = {
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsavelNome: string;
  responsavelCpf: string;
  anoIR: number;
  parcelas: ParcelaIR[];
};

// Histórico compartilhado: uma linha por documento emitido, de qualquer tipo.
// `snapshot` guarda o documento como foi entregue e é lido conforme o `tipo`.
type DocumentoRow = {
  id: string;
  numero: number;
  tipo: string;
  unidade: string;
  aluno_id: string;
  aluno_nome: string;
  responsavel_nome: string;
  data_recibo: string;
  valor_total: number;
  created_at: string;
  created_by_nome: string;
  snapshot: ReciboSnapshot | DeclaracaoSnapshot | DeclaracaoIRSnapshot;
};

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function DocumentosPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <FileText className="h-6 w-6 text-primary" /> Documentos
        </h1>
        <p className="text-sm text-muted-foreground">
          Emissão de documentos oficiais do colégio com os dados do Sponte. Nada aqui altera o
          cadastro financeiro do aluno: o recibo é um documento, não uma baixa.
        </p>
      </div>

      <Tabs defaultValue="documento">
        <TabsList>
          <TabsTrigger value="documento" className="gap-1">
            <FileText className="h-4 w-4" /> Gerar Documento
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-1">
            <History className="h-4 w-4" /> Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documento" className="mt-4">
          <GerarDocumento />
        </TabsContent>
        <TabsContent value="historico" className="mt-4">
          <HistoricoDocumentos />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Seletor de modelo ──────────────────────────────────────────────────────
// Cada modelo tem seu próprio fluxo (campos e validações são diferentes); a
// tela só escolhe qual renderizar. Modelo novo entra em TIPOS_DOCUMENTO e ganha
// um case aqui, sem mexer no resto.
function GerarDocumento() {
  const [tipo, setTipo] = useState<TipoDocumento>("recibo");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Tipo de documento</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDocumento)}>
            <SelectTrigger className="h-9 w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_DOCUMENTO.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {tipo === "recibo" && <GerarRecibo />}
      {tipo === "declaracao_debitos" && <GerarDeclaracaoDebitos />}
      {tipo === "declaracao_ir" && <GerarDeclaracaoIR />}
    </div>
  );
}

// ─── Passo a passo do recibo ────────────────────────────────────────────────
function GerarRecibo() {
  const { canEdit } = usePermissions();
  const { session } = useAuth();
  const qc = useQueryClient();
  const podeEditar = canEdit("documentos");

  const { data: colegios = [] } = useColegios();
  const buscar = useServerFn(buscarAlunosSponte);
  const buscarCadastro = useServerFn(buscarDadosCadastraisAluno);

  const [unidade, setUnidade] = useState<string>(UNIDADES[0]);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [aluno, setAluno] = useState<AlunoRecibo | null>(null);
  const [responsaveis, setResponsaveis] = useState<ResponsavelCadastroSponte[]>([]);
  const [responsavelId, setResponsavelId] = useState<string>("");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [dataRecibo, setDataRecibo] = useState<string>(hojeYMD());

  const colegio = colegios.find((c) => c.unidade === unidade) ?? null;

  const responsavel = useMemo<ResponsavelRecibo | null>(() => {
    const r = responsaveis.find((x) => x.responsavelId === responsavelId);
    return r ? { ...r } : null;
  }, [responsaveis, responsavelId]);

  const valoresNumericos = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(valores)) {
      const n = parseBRLNumber(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  }, [valores]);

  const itens = useMemo(() => itensDoRecibo(valoresNumericos), [valoresNumericos]);
  const total = useMemo(() => itens.reduce((acc, i) => acc + i.valor, 0), [itens]);

  const erros = validarRecibo({
    colegio: colegio ? paraColegioRecibo(colegio) : null,
    aluno,
    responsavel,
    itens,
    dataRecibo,
  });

  const limparAluno = () => {
    setAluno(null);
    setResponsaveis([]);
    setResponsavelId("");
    setValores({});
  };

  const buscarAlunos = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: termo.trim(), unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      return r.alunos;
    },
    onSuccess: (alunos) => setResultados(alunos),
    onError: (e) => {
      setResultados(null);
      toast.error(e instanceof Error ? e.message : "Falha na busca.");
    },
  });

  const selecionarAluno = useMutation({
    mutationFn: async (encontrado: AlunoBuscaSponte) => {
      const r = await buscarCadastro({ data: { alunoId: encontrado.alunoId, unidade } });
      if (r.error) throw new Error(r.error);
      return r;
    },
    onSuccess: (r) => {
      if (!r.aluno) {
        toast.error("Aluno não encontrado no Sponte.");
        return;
      }
      setAluno({
        alunoId: r.aluno.alunoId,
        nome: r.aluno.nome,
        cpf: r.aluno.cpf,
        turma: r.aluno.turma,
        matricula: r.aluno.matricula,
      });
      setResponsaveis(r.responsaveis);
      setResponsavelId(r.responsaveis[0]?.responsavelId ?? "");
      setResultados(null);
      setTermo("");
      if (r.responsaveis.length === 0) {
        toast.error("O aluno não tem responsável cadastrado no Sponte.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar o aluno."),
  });

  const gerar = useMutation({
    mutationFn: async () => {
      if (!colegio || !aluno || !responsavel) throw new Error("Recibo incompleto.");
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const snapshot: ReciboSnapshot = {
        colegio: paraColegioRecibo(colegio),
        aluno,
        responsavel,
        valores: Object.fromEntries(itens.map((i) => [i.id, i.valor])),
      };
      // O número impresso vem da sequência do banco: gravamos primeiro e só
      // então montamos o PDF, para que documento e histórico nunca divirjam.
      const { data, error } = await supabase
        .from("documentos_recibos" as never)
        .insert({
          tipo: "recibo",
          unidade,
          aluno_id: aluno.alunoId,
          aluno_nome: aluno.nome,
          responsavel_id: responsavel.responsavelId,
          responsavel_nome: responsavel.nome,
          responsavel_cpf: responsavel.cpf,
          data_recibo: dataRecibo,
          valor_total: total,
          itens,
          snapshot,
          created_by: session?.user?.id ?? null,
          created_by_nome: meta?.full_name || session?.user?.email || "",
        } as never)
        .select("numero")
        .single();
      if (error) throw new Error(error.message);
      const numero = Number((data as unknown as { numero: number }).numero);
      const documento = montarRecibo({
        numero,
        dataRecibo,
        colegio: snapshot.colegio,
        aluno: snapshot.aluno,
        responsavel: snapshot.responsavel,
        valores: snapshot.valores,
      });
      await baixarPdfRecibo(documento, await carregarLogoDoColegio(colegio.logo_path));
      return numero;
    },
    onSuccess: (numero) => {
      toast.success(`Recibo nº ${numero} gerado e baixado.`);
      qc.invalidateQueries({ queryKey: ["documentos_recibos"] });
      setValores({});
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao gerar o recibo."),
  });

  const t = termo.trim();
  const termoValido = /^\d+$/.test(t) ? t.length >= 1 : t.length >= 3;

  if (!podeEditar) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Você tem acesso somente de leitura em Documentos: consulte os recibos já emitidos na aba
        Histórico.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Passo 1 — aluno */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Search className="h-4 w-4 text-primary" /> 1. Aluno
          </h2>
        </header>
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Colégio</Label>
              <Select
                value={unidade}
                onValueChange={(v) => {
                  setUnidade(v);
                  setResultados(null);
                  limparAluno();
                }}
              >
                <SelectTrigger className="h-9 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIDADES.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="doc-busca" className="text-[11px] text-muted-foreground">
                Aluno (nome ou AlunoID do Sponte)
              </Label>
              <Input
                id="doc-busca"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && termoValido) buscarAlunos.mutate();
                }}
                placeholder="ex.: Bento ou 672"
                className="h-9 w-64"
              />
            </div>
            <Button
              variant="outline"
              className="h-9 gap-1"
              disabled={!termoValido || buscarAlunos.isPending}
              onClick={() => buscarAlunos.mutate()}
            >
              {buscarAlunos.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Buscar no Sponte
            </Button>
          </div>

          {resultados && resultados.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Nenhum aluno encontrado para “{t}” em {unidade}.
            </div>
          )}

          {resultados && resultados.length > 0 && (
            <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {resultados.map((a) => (
                <button
                  key={a.alunoId}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  disabled={selecionarAluno.isPending}
                  onClick={() => selecionarAluno.mutate(a)}
                >
                  <span>
                    <span className="font-medium">{a.nome}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      #{a.alunoId} · {a.turma || "sem turma"} · {a.situacao}
                    </span>
                  </span>
                  {selecionarAluno.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <User className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          )}

          {aluno && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {aluno.nome}{" "}
                  <span className="text-xs text-muted-foreground">#{aluno.alunoId}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {[
                    aluno.cpf ? `CPF ${aluno.cpf}` : "",
                    aluno.matricula ? `Matrícula ${aluno.matricula}` : "",
                    aluno.turma,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <Button variant="ghost" className="h-8 text-xs" onClick={limparAluno}>
                Trocar aluno
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Passo 2 — responsável */}
      {aluno && (
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <User className="h-4 w-4 text-primary" /> 2. Responsável que consta no recibo
            </h2>
          </header>
          <div className="space-y-2 px-4 py-3">
            {responsaveis.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Nenhum responsável vinculado a este aluno no Sponte.
              </div>
            )}
            {responsaveis.map((r) => (
              <label
                key={r.responsavelId}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                  r.responsavelId === responsavelId
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <input
                  type="radio"
                  className="mt-1"
                  name="responsavel-recibo"
                  checked={r.responsavelId === responsavelId}
                  onChange={() => setResponsavelId(r.responsavelId)}
                />
                <span>
                  <span className="font-medium">{r.nome}</span>
                  {r.financeiro && (
                    <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                      Responsável financeiro
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {[r.parentesco, r.cpf ? `CPF ${r.cpf}` : "", r.telefone, r.email]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* Passo 3 — valores e data */}
      {aluno && (
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Receipt className="h-4 w-4 text-primary" /> 3. Valores e data
            </h2>
            <p className="text-xs text-muted-foreground">
              Todos os tópicos começam zerados. Entram no recibo apenas os que você preencher.
            </p>
          </header>
          <div className="space-y-4 px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TOPICOS_RECIBO.map((topico) => (
                <div key={topico.id} className="flex flex-col gap-1">
                  <Label
                    htmlFor={`valor-${topico.id}`}
                    className="text-[11px] text-muted-foreground"
                  >
                    {topico.descricao}
                  </Label>
                  <Input
                    id={`valor-${topico.id}`}
                    inputMode="decimal"
                    value={valores[topico.id] ?? ""}
                    placeholder="0,00"
                    className="h-9"
                    onChange={(e) =>
                      setValores((prev) => ({ ...prev, [topico.id]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="data-recibo" className="text-[11px] text-muted-foreground">
                  Data que consta no recibo
                </Label>
                <Input
                  id="data-recibo"
                  type="date"
                  value={dataRecibo}
                  className="h-9 w-44"
                  onChange={(e) => setDataRecibo(e.target.value)}
                />
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Total do recibo
                </div>
                <div className="text-2xl font-semibold text-primary">{formatarBRL(total)}</div>
                <div className="text-xs text-muted-foreground">
                  {itens.length} tópico(s) incluído(s)
                </div>
              </div>
            </div>

            {erros.length > 0 && (
              <ul className="list-inside list-disc rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {erros.map((erro) => (
                  <li key={erro}>{erro}</li>
                ))}
              </ul>
            )}

            <div className="flex justify-end">
              <Button
                className="gap-1"
                disabled={erros.length > 0 || gerar.isPending}
                onClick={() => gerar.mutate()}
              >
                {gerar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Gerar Recibo (PDF)
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

const SEM_PENDENCIA: PendenciasAluno = {
  total: 0,
  vencidas: 0,
  aVencer: 0,
  valor: 0,
  valorVencido: 0,
};

// ─── Declaração de Inexistência de Débitos ──────────────────────────────────
function GerarDeclaracaoDebitos() {
  const { canEdit } = usePermissions();
  const { session } = useAuth();
  const qc = useQueryClient();
  const podeEditar = canEdit("documentos");

  const { data: colegios = [] } = useColegios();
  const buscar = useServerFn(buscarAlunosSponte);
  const buscarCadastro = useServerFn(buscarDadosCadastraisAluno);
  const buscarTitulos = useServerFn(fetchTitulosAlunoSponte);

  const [unidade, setUnidade] = useState<string>(UNIDADES[0]);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [aluno, setAluno] = useState<AlunoRecibo | null>(null);
  const [responsaveis, setResponsaveis] = useState<ResponsavelDeclaracao[]>([]);
  const [dataDocumento, setDataDocumento] = useState<string>(hojeYMD());
  const [pendencias, setPendencias] = useState<PendenciasAluno | null>(null);
  const [confirmado, setConfirmado] = useState(false);

  const colegio = colegios.find((c) => c.unidade === unidade) ?? null;
  const colegioDeclaracao = colegio ? paraColegioRecibo(colegio) : null;

  const erros = validarDeclaracao({ colegio: colegioDeclaracao, aluno, dataDocumento });

  const limparAluno = () => {
    setAluno(null);
    setResponsaveis([]);
    setPendencias(null);
    setConfirmado(false);
  };

  const buscarAlunos = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: termo.trim(), unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      return r.alunos;
    },
    onSuccess: (alunos) => setResultados(alunos),
    onError: (e) => {
      setResultados(null);
      toast.error(e instanceof Error ? e.message : "Falha na busca.");
    },
  });

  // Ao escolher o aluno já trazemos o cadastro (nome + responsáveis) e as
  // parcelas: a checagem financeira precisa estar na tela ANTES da emissão.
  const selecionarAluno = useMutation({
    mutationFn: async (encontrado: AlunoBuscaSponte) => {
      const cadastro = await buscarCadastro({ data: { alunoId: encontrado.alunoId, unidade } });
      if (cadastro.error) throw new Error(cadastro.error);
      const titulos = await buscarTitulos({ data: { alunoId: encontrado.alunoId, unidade } });
      if (titulos.error) throw new Error(titulos.error);
      if (titulos.indisponivel) {
        throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      }
      return { cadastro, titulos };
    },
    onSuccess: ({ cadastro, titulos }) => {
      if (!cadastro.aluno) {
        toast.error("Aluno não encontrado no Sponte.");
        return;
      }
      setAluno({
        alunoId: cadastro.aluno.alunoId,
        nome: cadastro.aluno.nome,
        cpf: cadastro.aluno.cpf,
        turma: cadastro.aluno.turma,
        matricula: cadastro.aluno.matricula,
      });
      setResponsaveis(
        cadastro.responsaveis.map((r) => ({
          responsavelId: r.responsavelId,
          nome: r.nome,
          cpf: r.cpf,
          parentesco: r.parentesco,
        })),
      );
      setPendencias(pendenciasEmAberto(titulos.titulos, hojeYMD()));
      setConfirmado(false);
      setResultados(null);
      setTermo("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar o aluno."),
  });

  const previa = useMemo(() => {
    if (!colegioDeclaracao || !aluno) return null;
    return montarDeclaracaoDebitos({
      numero: 0,
      dataDocumento,
      colegio: colegioDeclaracao,
      aluno,
      responsaveis,
      pendencias: pendencias ?? SEM_PENDENCIA,
    });
  }, [colegioDeclaracao, aluno, responsaveis, dataDocumento, pendencias]);

  const gerar = useMutation({
    mutationFn: async () => {
      if (!colegio || !colegioDeclaracao || !aluno || !pendencias) {
        throw new Error("Declaração incompleta.");
      }
      if (exigeConfirmacao(pendencias) && !confirmado) {
        throw new Error("Confirme o aviso de parcelas vencidas antes de emitir.");
      }
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const snapshot: DeclaracaoSnapshot = {
        colegio: colegioDeclaracao,
        aluno,
        responsaveis,
        pendencias,
      };
      const { data, error } = await supabase
        .from("documentos_recibos" as never)
        .insert({
          tipo: "declaracao_debitos",
          unidade,
          aluno_id: aluno.alunoId,
          aluno_nome: aluno.nome,
          responsavel_id: responsaveis[0]?.responsavelId ?? "",
          responsavel_nome: responsaveis.map((r) => r.nome).join(" e "),
          responsavel_cpf: responsaveis[0]?.cpf ?? "",
          data_recibo: dataDocumento,
          valor_total: 0,
          itens: [],
          snapshot,
          created_by: session?.user?.id ?? null,
          created_by_nome: meta?.full_name || session?.user?.email || "",
        } as never)
        .select("numero")
        .single();
      if (error) throw new Error(error.message);
      const numero = Number((data as unknown as { numero: number }).numero);
      const documento = montarDeclaracaoDebitos({
        numero,
        dataDocumento,
        colegio: snapshot.colegio,
        aluno: snapshot.aluno,
        responsaveis: snapshot.responsaveis,
        pendencias: snapshot.pendencias,
      });
      await baixarPdfDeclaracao(documento, await carregarLogoDoColegio(colegio.logo_path));
      return numero;
    },
    onSuccess: (numero) => {
      toast.success(`Declaração nº ${numero} gerada e baixada.`);
      qc.invalidateQueries({ queryKey: ["documentos_recibos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao gerar a declaração."),
  });

  const t = termo.trim();
  const termoValido = /^\d+$/.test(t) ? t.length >= 1 : t.length >= 3;
  const bloqueadoPorPendencia = !!pendencias && exigeConfirmacao(pendencias) && !confirmado;

  if (!podeEditar) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Você tem acesso somente de leitura em Documentos: consulte os documentos já emitidos na aba
        Histórico.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Passo 1 — aluno */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Search className="h-4 w-4 text-primary" /> 1. Aluno
          </h2>
          <p className="text-xs text-muted-foreground">
            O nome completo do aluno, os responsáveis e as parcelas em aberto vêm do Sponte.
          </p>
        </header>
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Colégio</Label>
              <Select
                value={unidade}
                onValueChange={(v) => {
                  setUnidade(v);
                  setResultados(null);
                  limparAluno();
                }}
              >
                <SelectTrigger className="h-9 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIDADES.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="decl-busca" className="text-[11px] text-muted-foreground">
                Aluno (nome ou AlunoID do Sponte)
              </Label>
              <Input
                id="decl-busca"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && termoValido) buscarAlunos.mutate();
                }}
                placeholder="ex.: Bento ou 672"
                className="h-9 w-64"
              />
            </div>
            <Button
              variant="outline"
              className="h-9 gap-1"
              disabled={!termoValido || buscarAlunos.isPending}
              onClick={() => buscarAlunos.mutate()}
            >
              {buscarAlunos.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Buscar no Sponte
            </Button>
          </div>

          {resultados && resultados.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Nenhum aluno encontrado para “{t}” em {unidade}.
            </div>
          )}

          {resultados && resultados.length > 0 && (
            <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {resultados.map((a) => (
                <button
                  key={a.alunoId}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  disabled={selecionarAluno.isPending}
                  onClick={() => selecionarAluno.mutate(a)}
                >
                  <span>
                    <span className="font-medium">{a.nome}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      #{a.alunoId} · {a.turma || "sem turma"} · {a.situacao}
                    </span>
                  </span>
                  {selecionarAluno.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <User className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          )}

          {aluno && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {aluno.nome}{" "}
                  <span className="text-xs text-muted-foreground">#{aluno.alunoId}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {responsaveis.length > 0
                    ? `Responsáveis: ${responsaveis
                        .map((r) => `${r.nome}${r.parentesco ? ` (${r.parentesco})` : ""}`)
                        .join(" · ")}`
                    : "Nenhum responsável vinculado no Sponte."}
                </div>
              </div>
              <Button variant="ghost" className="h-8 text-xs" onClick={limparAluno}>
                Trocar aluno
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Passo 2 — data, checagem financeira e emissão */}
      {aluno && previa && (
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FileText className="h-4 w-4 text-primary" /> 2. Data e conferência
            </h2>
          </header>
          <div className="space-y-4 px-4 py-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="data-declaracao" className="text-[11px] text-muted-foreground">
                Data que consta na declaração
              </Label>
              <Input
                id="data-declaracao"
                type="date"
                value={dataDocumento}
                className="h-9 w-44"
                onChange={(e) => setDataDocumento(e.target.value)}
              />
            </div>

            <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm leading-relaxed">
              {previa.texto}
            </div>

            {pendencias && !exigeConfirmacao(pendencias) && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Conferido no Sponte: nenhuma parcela vencida para este aluno
                {pendencias.aVencer > 0
                  ? ` (${pendencias.aVencer} parcela[s] a vencer, ainda dentro do prazo)`
                  : ""}
                .
              </div>
            )}

            {pendencias && exigeConfirmacao(pendencias) && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <div className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <span>
                    Atenção: este aluno possui {pendencias.vencidas} parcela(s) vencida(s) em aberto
                    no Sponte, somando {formatarBRL(pendencias.valorVencido)}
                    {pendencias.aVencer > 0
                      ? ` (há também ${pendencias.aVencer} parcela[s] a vencer, que não contam como débito hoje)`
                      : ""}
                    . Confirma mesmo assim a emissão da declaração de inexistência de débitos?
                  </span>
                </div>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={confirmado}
                    onChange={(e) => setConfirmado(e.target.checked)}
                  />
                  Sim, confirmo a emissão mesmo com parcela(s) vencida(s).
                </label>
              </div>
            )}

            {erros.length > 0 && (
              <ul className="list-inside list-disc rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {erros.map((erro) => (
                  <li key={erro}>{erro}</li>
                ))}
              </ul>
            )}

            <div className="flex justify-end">
              <Button
                className="gap-1"
                disabled={
                  erros.length > 0 || bloqueadoPorPendencia || !pendencias || gerar.isPending
                }
                onClick={() => gerar.mutate()}
              >
                {gerar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Gerar Declaração (PDF)
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Declaração de Imposto de Renda ─────────────────────────────────────────
// Mesmo fluxo de aluno da declaração de débitos; o que muda é o seletor de
// exercício (IR ano X = pagamentos do ano X-1) e a tabela de pagamentos.
function GerarDeclaracaoIR() {
  const { canEdit } = usePermissions();
  const { session } = useAuth();
  const qc = useQueryClient();
  const podeEditar = canEdit("documentos");

  const { data: colegios = [] } = useColegios();
  const buscar = useServerFn(buscarAlunosSponte);
  const buscarCadastro = useServerFn(buscarDadosCadastraisAluno);
  const buscarTitulos = useServerFn(fetchTitulosAlunoSponte);

  const hoje = hojeYMD();
  const [unidade, setUnidade] = useState<string>(UNIDADES[0]);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [aluno, setAluno] = useState<AlunoRecibo | null>(null);
  const [responsavel, setResponsavel] = useState<ResponsavelCadastroSponte | null>(null);
  const [parcelas, setParcelas] = useState<ParcelaIR[]>([]);
  const [anoIR, setAnoIR] = useState<number>(anoIRPadrao(hoje));
  const [dataDocumento, setDataDocumento] = useState<string>(hoje);

  const anos = useMemo(() => anosIRDisponiveis(hoje), [hoje]);
  const colegio = colegios.find((c) => c.unidade === unidade) ?? null;
  const colegioIR = colegio ? paraColegioRecibo(colegio) : null;

  const pagamentos = useMemo(() => pagamentosIR(parcelas, anoIR), [parcelas, anoIR]);
  const total = useMemo(() => totalPagamentosIR(pagamentos), [pagamentos]);
  const erros = validarDeclaracaoIR({ colegio: colegioIR, aluno, dataDocumento, pagamentos });

  const limparAluno = () => {
    setAluno(null);
    setResponsavel(null);
    setParcelas([]);
  };

  const buscarAlunos = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: termo.trim(), unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      return r.alunos;
    },
    onSuccess: (alunos) => setResultados(alunos),
    onError: (e) => {
      setResultados(null);
      toast.error(e instanceof Error ? e.message : "Falha na busca.");
    },
  });

  const selecionarAluno = useMutation({
    mutationFn: async (encontrado: AlunoBuscaSponte) => {
      const cadastro = await buscarCadastro({ data: { alunoId: encontrado.alunoId, unidade } });
      if (cadastro.error) throw new Error(cadastro.error);
      const titulos = await buscarTitulos({ data: { alunoId: encontrado.alunoId, unidade } });
      if (titulos.error) throw new Error(titulos.error);
      if (titulos.indisponivel) {
        throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      }
      return { cadastro, titulos };
    },
    onSuccess: ({ cadastro, titulos }) => {
      if (!cadastro.aluno) {
        toast.error("Aluno não encontrado no Sponte.");
        return;
      }
      setAluno({
        alunoId: cadastro.aluno.alunoId,
        nome: cadastro.aluno.nome,
        cpf: cadastro.aluno.cpf,
        turma: cadastro.aluno.turma,
        matricula: cadastro.aluno.matricula,
      });
      // `buscarDadosCadastraisAluno` já ordena o responsável financeiro primeiro.
      const financeiro =
        cadastro.responsaveis.find((r) => r.financeiro) ?? cadastro.responsaveis[0] ?? null;
      setResponsavel(financeiro);
      setParcelas(
        titulos.titulos.map((t) => ({
          categoria: t.categoria,
          numeroParcela: t.numeroParcela,
          valorPago: t.valorPago,
          dataPagamento: t.dataPagamento,
        })),
      );
      setResultados(null);
      setTermo("");
      if (!financeiro) toast.error("O aluno não tem responsável cadastrado no Sponte.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar o aluno."),
  });

  const gerar = useMutation({
    mutationFn: async () => {
      if (!colegio || !colegioIR || !aluno) throw new Error("Declaração incompleta.");
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const snapshot: DeclaracaoIRSnapshot = {
        colegio: colegioIR,
        aluno,
        responsavelNome: responsavel?.nome ?? "",
        responsavelCpf: responsavel?.cpf ?? "",
        anoIR,
        parcelas: pagamentos.map((p) => ({
          categoria: p.categoria,
          numeroParcela: p.parcela,
          valorPago: p.valor,
          dataPagamento: p.dataPagamento,
        })),
      };
      const { data, error } = await supabase
        .from("documentos_recibos" as never)
        .insert({
          tipo: "declaracao_ir",
          unidade,
          aluno_id: aluno.alunoId,
          aluno_nome: aluno.nome,
          responsavel_id: responsavel?.responsavelId ?? "",
          responsavel_nome: responsavel?.nome ?? "",
          responsavel_cpf: responsavel?.cpf ?? "",
          data_recibo: dataDocumento,
          valor_total: total,
          itens: [],
          snapshot,
          created_by: session?.user?.id ?? null,
          created_by_nome: meta?.full_name || session?.user?.email || "",
        } as never)
        .select("numero")
        .single();
      if (error) throw new Error(error.message);
      const numero = Number((data as unknown as { numero: number }).numero);
      const documento = montarDeclaracaoIR({
        numero,
        anoIR,
        dataDocumento,
        colegio: snapshot.colegio,
        aluno: snapshot.aluno,
        responsavelNome: snapshot.responsavelNome,
        responsavelCpf: snapshot.responsavelCpf,
        parcelas: snapshot.parcelas,
      });
      await baixarPdfDeclaracaoIR(documento, await carregarLogoDoColegio(colegio.logo_path));
      return numero;
    },
    onSuccess: (numero) => {
      toast.success(`Declaração de IR nº ${numero} gerada e baixada.`);
      qc.invalidateQueries({ queryKey: ["documentos_recibos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao gerar a declaração."),
  });

  const t = termo.trim();
  const termoValido = /^\d+$/.test(t) ? t.length >= 1 : t.length >= 3;

  if (!podeEditar) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Você tem acesso somente de leitura em Documentos: consulte os documentos já emitidos na aba
        Histórico.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Passo 1 — aluno */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Search className="h-4 w-4 text-primary" /> 1. Aluno
          </h2>
          <p className="text-xs text-muted-foreground">
            O nome do aluno, o responsável financeiro e os pagamentos vêm do Sponte.
          </p>
        </header>
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Colégio</Label>
              <Select
                value={unidade}
                onValueChange={(v) => {
                  setUnidade(v);
                  setResultados(null);
                  limparAluno();
                }}
              >
                <SelectTrigger className="h-9 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIDADES.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ir-busca" className="text-[11px] text-muted-foreground">
                Aluno (nome ou AlunoID do Sponte)
              </Label>
              <Input
                id="ir-busca"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && termoValido) buscarAlunos.mutate();
                }}
                placeholder="ex.: Bento ou 672"
                className="h-9 w-64"
              />
            </div>
            <Button
              variant="outline"
              className="h-9 gap-1"
              disabled={!termoValido || buscarAlunos.isPending}
              onClick={() => buscarAlunos.mutate()}
            >
              {buscarAlunos.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Buscar no Sponte
            </Button>
          </div>

          {resultados && resultados.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Nenhum aluno encontrado para “{t}” em {unidade}.
            </div>
          )}

          {resultados && resultados.length > 0 && (
            <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {resultados.map((a) => (
                <button
                  key={a.alunoId}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  disabled={selecionarAluno.isPending}
                  onClick={() => selecionarAluno.mutate(a)}
                >
                  <span>
                    <span className="font-medium">{a.nome}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      #{a.alunoId} · {a.turma || "sem turma"} · {a.situacao}
                    </span>
                  </span>
                  {selecionarAluno.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <User className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          )}

          {aluno && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {aluno.nome}{" "}
                  <span className="text-xs text-muted-foreground">#{aluno.alunoId}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {responsavel
                    ? `Responsável financeiro: ${responsavel.nome}${
                        responsavel.cpf ? ` · CPF ${responsavel.cpf}` : ""
                      }`
                    : "Nenhum responsável vinculado no Sponte."}
                </div>
              </div>
              <Button variant="ghost" className="h-8 text-xs" onClick={limparAluno}>
                Trocar aluno
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Passo 2 — exercício, conferência e emissão */}
      {aluno && (
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Receipt className="h-4 w-4 text-primary" /> 2. Ano do Imposto de Renda
            </h2>
          </header>
          <div className="space-y-4 px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-muted-foreground">Ano do Imposto de Renda</Label>
                <Select value={String(anoIR)} onValueChange={(v) => setAnoIR(Number(v))}>
                  <SelectTrigger className="h-9 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {anos.map((a) => (
                      <SelectItem key={a} value={String(a)}>
                        IR {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="data-ir" className="text-[11px] text-muted-foreground">
                  Data que consta no documento
                </Label>
                <Input
                  id="data-ir"
                  type="date"
                  value={dataDocumento}
                  className="h-9 w-44"
                  onChange={(e) => setDataDocumento(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                IR {anoIR} declara os pagamentos realizados em {anoReferenciaIR(anoIR)} (só
                Matrícula e Mensalidade já pagas).
              </p>
            </div>

            {pagamentos.length === 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Nenhum pagamento de Matrícula ou Mensalidade com baixa em {anoReferenciaIR(anoIR)}{" "}
                para este aluno no Sponte.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data do pagamento</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Parcela</TableHead>
                      <TableHead className="text-right">Valor pago</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagamentos.map((p, i) => (
                      <TableRow key={`${p.dataPagamento}-${p.categoria}-${p.parcela}-${i}`}>
                        <TableCell>{formatarDataBR(p.dataPagamento)}</TableCell>
                        <TableCell>{p.categoria}</TableCell>
                        <TableCell>{p.parcela || "—"}</TableCell>
                        <TableCell className="text-right">{formatarBRL(p.valor)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">
                        Total pago em {anoReferenciaIR(anoIR)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatarBRL(total)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            {erros.length > 0 && (
              <ul className="list-inside list-disc rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {erros.map((erro) => (
                  <li key={erro}>{erro}</li>
                ))}
              </ul>
            )}

            <div className="flex justify-end">
              <Button
                className="gap-1"
                disabled={erros.length > 0 || gerar.isPending}
                onClick={() => gerar.mutate()}
              >
                {gerar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Gerar Declaração de IR (PDF)
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Histórico ──────────────────────────────────────────────────────────────
function HistoricoDocumentos() {
  const { data: colegios = [] } = useColegios();
  const [unidade, setUnidade] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [baixando, setBaixando] = useState<string | null>(null);

  const { data: recibos = [], isLoading } = useQuery({
    queryKey: ["documentos_recibos"],
    queryFn: async (): Promise<DocumentoRow[]> => {
      const { data, error } = await supabase
        .from("documentos_recibos" as never)
        .select(
          "id, numero, tipo, unidade, aluno_id, aluno_nome, responsavel_nome, data_recibo, valor_total, created_at, created_by_nome, snapshot",
        )
        .order("numero", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DocumentoRow[];
    },
  });

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return recibos.filter(
      (r) =>
        (unidade === "todas" || r.unidade === unidade) &&
        (!termo ||
          r.aluno_nome.toLowerCase().includes(termo) ||
          r.aluno_id.includes(termo) ||
          r.responsavel_nome.toLowerCase().includes(termo) ||
          String(r.numero).includes(termo)),
    );
  }, [recibos, unidade, busca]);

  // Reimpressão: reusa o snapshot gravado, então o PDF sai idêntico ao original
  // mesmo que o cadastro do colégio ou do responsável tenha mudado depois.
  const reimprimir = async (row: DocumentoRow) => {
    setBaixando(row.id);
    try {
      const data = row.data_recibo.slice(0, 10);
      const logoPath = colegios.find((c) => c.unidade === row.unidade)?.logo_path ?? null;
      const logo = await carregarLogoDoColegio(logoPath);
      if (row.tipo === "declaracao_ir") {
        const snap = row.snapshot as DeclaracaoIRSnapshot;
        await baixarPdfDeclaracaoIR(
          montarDeclaracaoIR({
            numero: row.numero,
            anoIR: snap.anoIR,
            dataDocumento: data,
            colegio: snap.colegio,
            aluno: snap.aluno,
            responsavelNome: snap.responsavelNome ?? "",
            responsavelCpf: snap.responsavelCpf ?? "",
            parcelas: snap.parcelas ?? [],
          }),
          logo,
        );
        return;
      }
      if (row.tipo === "declaracao_debitos") {
        const snap = row.snapshot as DeclaracaoSnapshot;
        await baixarPdfDeclaracao(
          montarDeclaracaoDebitos({
            numero: row.numero,
            dataDocumento: data,
            colegio: snap.colegio,
            aluno: snap.aluno,
            responsaveis: snap.responsaveis ?? [],
            pendencias: snap.pendencias ?? SEM_PENDENCIA,
          }),
          logo,
        );
        return;
      }
      const snap = row.snapshot as ReciboSnapshot;
      await baixarPdfRecibo(
        montarRecibo({
          numero: row.numero,
          dataRecibo: data,
          colegio: snap.colegio,
          aluno: snap.aluno,
          responsavel: snap.responsavel,
          valores: snap.valores,
        }),
        logo,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reimprimir o documento.");
    } finally {
      setBaixando(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <History className="h-4 w-4 text-primary" /> Documentos emitidos
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">Colégio</Label>
            <Select value={unidade} onValueChange={setUnidade}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos os colégios</SelectItem>
                {UNIDADES.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="hist-busca" className="text-[11px] text-muted-foreground">
              Aluno, responsável ou nº
            </Label>
            <Input
              id="hist-busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="h-9 w-56"
              placeholder="ex.: Bento, 672 ou 00007"
            />
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : filtrados.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">Nenhum documento emitido ainda.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Colégio</TableHead>
              <TableHead>Aluno</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Emitido por</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrados.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">
                  {String(r.numero).padStart(5, "0")}
                </TableCell>
                <TableCell className="text-xs">{rotuloTipoDocumento(r.tipo)}</TableCell>
                <TableCell>{formatarDataBR(r.data_recibo.slice(0, 10))}</TableCell>
                <TableCell>{r.unidade}</TableCell>
                <TableCell>
                  {r.aluno_nome}
                  <span className="ml-1 text-xs text-muted-foreground">#{r.aluno_id}</span>
                </TableCell>
                <TableCell>{r.responsavel_nome}</TableCell>
                <TableCell className="text-right font-medium">
                  {r.tipo === "declaracao_debitos" ? "—" : formatarBRL(Number(r.valor_total))}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.created_by_nome || "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    className="h-8 gap-1 text-xs"
                    disabled={baixando === r.id}
                    onClick={() => reimprimir(r)}
                  >
                    {baixando === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    PDF
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
