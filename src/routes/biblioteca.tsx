import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookPlus,
  CheckCircle2,
  Library,
  Loader2,
  Printer,
  ScanBarcode,
  Search,
  Tag,
  Undo2,
} from "lucide-react";
import { usePermissions, useAuth, useSchool } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { SelecioneUnidade } from "@/components/SelecioneUnidade";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { selectAll } from "@/lib/supabase-paginate";
import { buscarAlunosSponte, type AlunoBuscaSponte } from "@/lib/sponte.functions";
import { BarcodeScannerDialog } from "@/components/biblioteca/BarcodeScannerDialog";
import { gerarEtiquetasPdf } from "@/lib/biblioteca-etiqueta";
import {
  ROTULO_BLOQUEIO,
  ROTULO_STATUS_EXEMPLAR,
  calcularDevolucao,
  resolverValoresBiblioteca,
  type BibliotecaValores,
  type BibliotecaValoresRegistro,
  dataPrevistaSugerida,
  emprestimoAtrasado,
  formatarCodigoExemplar,
  multaEmAberto,
  normalizarCodigoExemplar,
  pendenciasDoAluno,
  resumirPendencias,
  validarNovoEmprestimo,
  type EmprestimoBase,
  type StatusExemplar,
} from "@/lib/biblioteca";

export const Route = createFileRoute("/biblioteca")({
  head: () => ({ meta: [{ title: "Biblioteca — School Hub" }] }),
  component: BibliotecaGate,
});

function BibliotecaGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("biblioteca"))
    return <AccessDenied message="Você não tem permissão para acessar a Biblioteca." />;
  return <BibliotecaPage />;
}

// ---------------------------------------------------------------------------
// Tipos das linhas (RLS já restringe ao módulo + unidades do usuário)
// ---------------------------------------------------------------------------

interface Titulo {
  id: string;
  school_id: string;
  titulo: string;
  autor: string;
  editora: string;
  categoria: string;
}

interface Exemplar {
  id: string;
  school_id: string;
  titulo_id: string;
  codigo: string;
  status: StatusExemplar;
  observacao: string;
  created_at: string;
}

interface Emprestimo extends EmprestimoBase {
  school_id: string;
  exemplar_id: string;
  aluno_nome: string;
  turma: string;
  observacao: string;
  created_by_nome: string;
  devolvido_por_nome: string;
  multa_paga_por_nome: string;
}

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function fmtData(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const COR_STATUS: Record<StatusExemplar, string> = {
  disponivel: "bg-emerald-100 text-emerald-800 border-emerald-200",
  emprestado: "bg-amber-100 text-amber-800 border-amber-200",
  manutencao: "bg-slate-100 text-slate-700 border-slate-200",
  perdido: "bg-red-100 text-red-800 border-red-200",
};

function StatusBadge({ status }: { status: StatusExemplar }) {
  return (
    <Badge variant="outline" className={COR_STATUS[status]}>
      {ROTULO_STATUS_EXEMPLAR[status]}
    </Badge>
  );
}

async function carregarTitulos(schoolId: string): Promise<Titulo[]> {
  return selectAll<Titulo>(() =>
    supabase
      .from("biblioteca_titulos" as never)
      .select("id, school_id, titulo, autor, editora, categoria")
      .eq("school_id", schoolId)
      .order("titulo")
      .order("id"),
  );
}

async function carregarExemplares(schoolId: string): Promise<Exemplar[]> {
  return selectAll<Exemplar>(() =>
    supabase
      .from("biblioteca_exemplares" as never)
      .select("id, school_id, titulo_id, codigo, status, observacao, created_at")
      .eq("school_id", schoolId)
      .order("codigo"),
  );
}

type ValoresRow = {
  id: string;
  school_id: string;
  ano_letivo: number;
  multa_por_dia_util: number | string;
  multa_teto: number | string;
  prazo_padrao_dias: number;
};

async function carregarValores(schoolId: string): Promise<BibliotecaValoresRegistro[]> {
  const { data, error } = await supabase
    .from("biblioteca_valores" as never)
    .select("id, school_id, ano_letivo, multa_por_dia_util, multa_teto, prazo_padrao_dias")
    .eq("school_id", schoolId)
    .returns<ValoresRow[]>();
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    schoolId: r.school_id,
    unidade: "",
    anoLetivo: Number(r.ano_letivo),
    multaPorDiaUtil: Number(r.multa_por_dia_util),
    multaTeto: Number(r.multa_teto),
    prazoPadraoDias: Number(r.prazo_padrao_dias),
    atualizadoEm: "",
    atualizadoPor: "",
  }));
}

// Valores (multa/teto/prazo) da unidade para o ano da data informada.
function valoresPara(ctx: Ctx, ymd: string): BibliotecaValores {
  return resolverValoresBiblioteca(ctx.valores, ctx.schoolId, Number(ymd.slice(0, 4))).valores;
}

async function carregarEmprestimos(schoolId: string): Promise<Emprestimo[]> {
  const rows = await selectAll<Emprestimo>(() =>
    supabase
      .from("biblioteca_emprestimos" as never)
      .select("*")
      .eq("school_id", schoolId)
      .order("data_emprestimo", { ascending: false })
      .order("id"),
  );
  return rows.map((e) => ({ ...e, multa_valor: Number(e.multa_valor) }));
}

function useNomeUsuario(): { userId: string | null; nome: string } {
  const { session } = useAuth();
  const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
  return {
    userId: session?.user?.id ?? null,
    nome: meta?.full_name || session?.user?.email || "",
  };
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function BibliotecaPage() {
  const { canEdit } = usePermissions();
  const { selected, schools } = useSchool();
  const school = schools.find((s) => s.id === selected) ?? null;
  const podeEditar = canEdit("biblioteca");

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2">
          <Library className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Biblioteca</h1>
          <p className="text-sm text-muted-foreground">
            Acervo, empréstimos e devoluções{school ? ` — ${school.name}` : ""}. Cada colégio tem o
            seu próprio acervo.
          </p>
        </div>
      </div>

      {!school ? (
        <SelecioneUnidade acao="A Biblioteca" />
      ) : (
        <BibliotecaUnidade
          key={school.id}
          schoolId={school.id}
          unidadeNome={school.name}
          podeEditar={podeEditar}
        />
      )}
    </div>
  );
}

function BibliotecaUnidade({
  schoolId,
  unidadeNome,
  podeEditar,
}: {
  schoolId: string;
  unidadeNome: string;
  podeEditar: boolean;
}) {
  const titulos = useQuery({
    queryKey: ["biblioteca_titulos", schoolId],
    queryFn: () => carregarTitulos(schoolId),
  });
  const exemplares = useQuery({
    queryKey: ["biblioteca_exemplares", schoolId],
    queryFn: () => carregarExemplares(schoolId),
  });
  const emprestimos = useQuery({
    queryKey: ["biblioteca_emprestimos", schoolId],
    queryFn: () => carregarEmprestimos(schoolId),
  });
  const valores = useQuery({
    queryKey: ["biblioteca_valores", schoolId],
    queryFn: () => carregarValores(schoolId),
  });

  if (titulos.isLoading || exemplares.isLoading || emprestimos.isLoading || valores.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (titulos.isError || exemplares.isError || emprestimos.isError) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar a Biblioteca desta unidade.
      </p>
    );
  }

  const ctx: Ctx = {
    schoolId,
    unidadeNome,
    podeEditar,
    titulos: titulos.data ?? [],
    exemplares: exemplares.data ?? [],
    emprestimos: emprestimos.data ?? [],
    valores: valores.data ?? [],
  };

  const abertos = ctx.emprestimos.filter((e) => e.data_devolucao === null).length;
  const pendentes = resumirPendencias(ctx.emprestimos, hojeYMD()).length;

  return (
    <Tabs defaultValue="circulacao">
      <TabsList>
        <TabsTrigger value="circulacao">
          Empréstimos {abertos > 0 && <Badge className="ml-2">{abertos}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="acervo">Acervo</TabsTrigger>
        <TabsTrigger value="pendencias">
          Pendências{" "}
          {pendentes > 0 && (
            <Badge variant="destructive" className="ml-2">
              {pendentes}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="circulacao" className="mt-4">
        <CirculacaoTab ctx={ctx} />
      </TabsContent>
      <TabsContent value="acervo" className="mt-4">
        <AcervoTab ctx={ctx} />
      </TabsContent>
      <TabsContent value="pendencias" className="mt-4">
        <PendenciasTab ctx={ctx} />
      </TabsContent>
    </Tabs>
  );
}

interface Ctx {
  schoolId: string;
  unidadeNome: string;
  podeEditar: boolean;
  titulos: Titulo[];
  exemplares: Exemplar[];
  emprestimos: Emprestimo[];
  valores: BibliotecaValoresRegistro[];
}

function useInvalidar(schoolId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["biblioteca_titulos", schoolId] });
    qc.invalidateQueries({ queryKey: ["biblioteca_exemplares", schoolId] });
    qc.invalidateQueries({ queryKey: ["biblioteca_emprestimos", schoolId] });
  };
}

// ---------------------------------------------------------------------------
// Acervo
// ---------------------------------------------------------------------------

function AcervoTab({ ctx }: { ctx: Ctx }) {
  const { schoolId, unidadeNome, podeEditar, titulos, exemplares } = ctx;
  const invalidar = useInvalidar(schoolId);
  const { userId, nome } = useNomeUsuario();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const [novo, setNovo] = useState({ titulo: "", autor: "", editora: "", categoria: "", qtd: "1" });

  const porTitulo = useMemo(() => {
    const m = new Map<string, Exemplar[]>();
    for (const e of exemplares) {
      const l = m.get(e.titulo_id) ?? [];
      l.push(e);
      m.set(e.titulo_id, l);
    }
    return m;
  }, [exemplares]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return titulos;
    const codigo = normalizarCodigoExemplar(t);
    return titulos.filter(
      (x) =>
        x.titulo.toLowerCase().includes(t) ||
        x.autor.toLowerCase().includes(t) ||
        x.editora.toLowerCase().includes(t) ||
        x.categoria.toLowerCase().includes(t) ||
        (codigo && (porTitulo.get(x.id) ?? []).some((e) => e.codigo === codigo)),
    );
  }, [busca, titulos, porTitulo]);

  const criarExemplares = async (tituloId: string, qtd: number, observacao = "") => {
    const linhas = Array.from({ length: qtd }, () => ({
      school_id: schoolId,
      titulo_id: tituloId,
      observacao,
      created_by: userId,
      created_by_nome: nome,
    }));
    const { data, error } = await supabase
      .from("biblioteca_exemplares" as never)
      .insert(linhas as never)
      .select("id, codigo");
    if (error) throw error;
    return (data ?? []) as { id: string; codigo: string }[];
  };

  const criarTitulo = useMutation({
    mutationFn: async () => {
      const qtd = Math.max(0, Math.min(200, parseInt(novo.qtd, 10) || 0));
      const { data, error } = await supabase
        .from("biblioteca_titulos" as never)
        .insert({
          school_id: schoolId,
          titulo: novo.titulo.trim(),
          autor: novo.autor.trim(),
          editora: novo.editora.trim(),
          categoria: novo.categoria.trim(),
          created_by: userId,
          created_by_nome: nome,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      if (qtd > 0) await criarExemplares(id, qtd);
      return { id, qtd };
    },
    onSuccess: ({ id, qtd }) => {
      toast.success("Título cadastrado", {
        description: qtd > 0 ? `${qtd} exemplar(es) gerado(s) com código de barras.` : undefined,
      });
      setNovo({ titulo: "", autor: "", editora: "", categoria: "", qtd: "1" });
      setAberto(id);
      invalidar();
    },
    onError: (e) => toast.error("Erro ao cadastrar", { description: e.message }),
  });

  const adicionarExemplares = useMutation({
    mutationFn: ({ tituloId, qtd, obs }: { tituloId: string; qtd: number; obs?: string }) =>
      criarExemplares(tituloId, qtd, obs),
    onSuccess: (novos) => {
      toast.success(`${novos.length} exemplar(es) adicionado(s)`, {
        description: novos.map((n) => formatarCodigoExemplar(n.codigo)).join(", "),
      });
      invalidar();
    },
    onError: (e) => toast.error("Erro ao adicionar exemplar", { description: e.message }),
  });

  const alterarStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StatusExemplar }) => {
      const { error } = await supabase
        .from("biblioteca_exemplares" as never)
        .update({ status } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidar(),
    onError: (e) => toast.error("Erro ao alterar status", { description: e.message }),
  });

  const etiquetas = (lista: Exemplar[], nomeArquivo: string) => {
    const mapa = new Map(titulos.map((t) => [t.id, t.titulo]));
    void gerarEtiquetasPdf(
      lista.map((e) => ({
        codigo: e.codigo,
        titulo: mapa.get(e.titulo_id) ?? "",
        unidade: unidadeNome,
      })),
      nomeArquivo,
    );
  };

  const emCirculacao = exemplares.filter((e) => e.status !== "perdido");

  return (
    <div className="space-y-6">
      {podeEditar && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BookPlus className="h-4 w-4" /> Novo título
          </h3>
          <div className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-2">
              <Label>Título *</Label>
              <Input
                value={novo.titulo}
                onChange={(e) => setNovo({ ...novo, titulo: e.target.value })}
              />
            </div>
            <div>
              <Label>Autor</Label>
              <Input
                value={novo.autor}
                onChange={(e) => setNovo({ ...novo, autor: e.target.value })}
              />
            </div>
            <div>
              <Label>Editora</Label>
              <Input
                value={novo.editora}
                onChange={(e) => setNovo({ ...novo, editora: e.target.value })}
              />
            </div>
            <div>
              <Label>Categoria / gênero</Label>
              <Input
                value={novo.categoria}
                onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}
                placeholder="Infantil, Romance…"
              />
            </div>
            <div>
              <Label>Exemplares</Label>
              <Input
                type="number"
                min={0}
                max={200}
                value={novo.qtd}
                onChange={(e) => setNovo({ ...novo, qtd: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              disabled={!novo.titulo.trim() || criarTitulo.isPending}
              onClick={() => criarTitulo.mutate()}
            >
              {criarTitulo.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cadastrar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por título, autor, editora, categoria ou código"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {titulos.length} título(s) · {emCirculacao.length} exemplar(es) em circulação
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={emCirculacao.length === 0}
          onClick={() => etiquetas(emCirculacao, `etiquetas-biblioteca-${unidadeNome}.pdf`)}
        >
          <Printer className="mr-2 h-4 w-4" /> Etiquetas de todo o acervo
        </Button>
      </div>

      {filtrados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {titulos.length === 0 ? "Nenhum título cadastrado nesta unidade." : "Nada encontrado."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Título</th>
                <th className="px-3 py-2">Autor</th>
                <th className="px-3 py-2">Editora</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2 text-center">Disp.</th>
                <th className="px-3 py-2 text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((t) => {
                const ex = porTitulo.get(t.id) ?? [];
                const disp = ex.filter((e) => e.status === "disponivel").length;
                const abertoAqui = aberto === t.id;
                return (
                  <TituloRows
                    key={t.id}
                    titulo={t}
                    exemplares={ex}
                    disponiveis={disp}
                    aberto={abertoAqui}
                    onToggle={() => setAberto(abertoAqui ? null : t.id)}
                    podeEditar={podeEditar}
                    onEtiqueta={(lista) =>
                      etiquetas(lista, `etiqueta-${lista[0]?.codigo ?? t.id}.pdf`)
                    }
                    onAdicionar={(qtd, obs) =>
                      adicionarExemplares.mutate({ tituloId: t.id, qtd, obs })
                    }
                    onStatus={(id, status) => alterarStatus.mutate({ id, status })}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TituloRows({
  titulo,
  exemplares,
  disponiveis,
  aberto,
  onToggle,
  podeEditar,
  onEtiqueta,
  onAdicionar,
  onStatus,
}: {
  titulo: Titulo;
  exemplares: Exemplar[];
  disponiveis: number;
  aberto: boolean;
  onToggle: () => void;
  podeEditar: boolean;
  onEtiqueta: (lista: Exemplar[]) => void;
  onAdicionar: (qtd: number, obs?: string) => void;
  onStatus: (id: string, status: StatusExemplar) => void;
}) {
  const [qtd, setQtd] = useState("1");
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={onToggle}>
        <td className="px-3 py-2 font-medium">{titulo.titulo}</td>
        <td className="px-3 py-2">{titulo.autor || "—"}</td>
        <td className="px-3 py-2">{titulo.editora || "—"}</td>
        <td className="px-3 py-2">{titulo.categoria || "—"}</td>
        <td className="px-3 py-2 text-center">{disponiveis}</td>
        <td className="px-3 py-2 text-center">{exemplares.length}</td>
      </tr>
      {aberto && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={6} className="px-3 py-3">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exemplares.length === 0}
                  onClick={() => onEtiqueta(exemplares.filter((e) => e.status !== "perdido"))}
                >
                  <Printer className="mr-2 h-4 w-4" /> Etiquetas deste título
                </Button>
                {podeEditar && (
                  <div className="ml-auto flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      className="w-20"
                      value={qtd}
                      onChange={(e) => setQtd(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onAdicionar(Math.max(1, parseInt(qtd, 10) || 1))}
                    >
                      <BookPlus className="mr-2 h-4 w-4" /> Adicionar exemplar(es)
                    </Button>
                  </div>
                )}
              </div>
              {exemplares.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum exemplar deste título.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1">Código</th>
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">Observação</th>
                      <th className="px-2 py-1 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exemplares.map((e) => (
                      <tr key={e.id} className="border-t border-border/60">
                        <td className="px-2 py-1 font-mono">{formatarCodigoExemplar(e.codigo)}</td>
                        <td className="px-2 py-1">
                          <StatusBadge status={e.status} />
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">{e.observacao || "—"}</td>
                        <td className="px-2 py-1">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Etiqueta"
                              onClick={() => onEtiqueta([e])}
                            >
                              <Tag className="h-4 w-4" />
                            </Button>
                            {podeEditar && e.status === "disponivel" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onStatus(e.id, "manutencao")}
                                >
                                  Manutenção
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        "Marcar este exemplar como perdido? Ele sai de circulação.",
                                      )
                                    )
                                      onStatus(e.id, "perdido");
                                  }}
                                >
                                  Perdido
                                </Button>
                              </>
                            )}
                            {podeEditar && e.status === "manutencao" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onStatus(e.id, "disponivel")}
                              >
                                Voltar a disponível
                              </Button>
                            )}
                            {podeEditar && e.status === "perdido" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="O aluno repôs fisicamente: entra como NOVO exemplar do mesmo título (sem cobrança)."
                                onClick={() => onAdicionar(1, `Reposição do exemplar ${e.codigo}`)}
                              >
                                Registrar reposição
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Circulação: empréstimo e devolução
// ---------------------------------------------------------------------------

function CirculacaoTab({ ctx }: { ctx: Ctx }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <NovoEmprestimo ctx={ctx} />
        <Devolucao ctx={ctx} />
      </div>
      <EmprestimosAbertos ctx={ctx} />
    </div>
  );
}

function NovoEmprestimo({ ctx }: { ctx: Ctx }) {
  const { schoolId, unidadeNome, podeEditar, titulos, exemplares, emprestimos } = ctx;
  const invalidar = useInvalidar(schoolId);
  const { userId, nome } = useNomeUsuario();
  const buscar = useServerFn(buscarAlunosSponte);

  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [aluno, setAluno] = useState<AlunoBuscaSponte | null>(null);
  const [codigo, setCodigo] = useState("");
  const [dataPrevista, setDataPrevista] = useState(() =>
    dataPrevistaSugerida(hojeYMD(), valoresPara(ctx, hojeYMD()).prazoPadraoDias),
  );
  const [scanAberto, setScanAberto] = useState(false);

  const hoje = hojeYMD();
  const mapaTitulos = useMemo(() => new Map(titulos.map((t) => [t.id, t])), [titulos]);
  const exemplar = useMemo(() => {
    const c = normalizarCodigoExemplar(codigo);
    return c ? (exemplares.find((e) => e.codigo === c) ?? null) : null;
  }, [codigo, exemplares]);

  const doAluno = useMemo(
    () => (aluno ? emprestimos.filter((e) => e.aluno_id === aluno.alunoId) : []),
    [aluno, emprestimos],
  );
  const pend = aluno ? pendenciasDoAluno(doAluno, hoje) : null;

  const buscarAlunos = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: termo.trim(), unidade: unidadeNome } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidadeNome}".`);
      return r.alunos;
    },
    onSuccess: (alunos) => {
      setResultados(alunos);
      if (alunos.length === 1) setAluno(alunos[0]);
    },
    onError: (e) => toast.error("Falha na busca", { description: e.message }),
  });

  const emprestar = useMutation({
    mutationFn: async () => {
      if (!aluno || !exemplar) throw new Error("Selecione o aluno e o exemplar.");
      if (dataPrevista < hoje) throw new Error("A data prevista não pode ser anterior a hoje.");
      const v = validarNovoEmprestimo(exemplar.status, doAluno, hoje);
      if (!v.ok) throw new Error(v.erro);
      const { error } = await supabase.from("biblioteca_emprestimos" as never).insert({
        school_id: schoolId,
        exemplar_id: exemplar.id,
        aluno_id: aluno.alunoId,
        aluno_nome: aluno.nome,
        turma: aluno.turma ?? "",
        data_emprestimo: hoje,
        data_prevista: dataPrevista,
        created_by: userId,
        created_by_nome: nome,
      } as never);
      if (error) {
        if (error.code === "23505")
          throw new Error("Este aluno ou exemplar já tem um empréstimo em aberto.");
        throw error;
      }
      const { error: e2 } = await supabase
        .from("biblioteca_exemplares" as never)
        .update({ status: "emprestado" } as never)
        .eq("id", exemplar.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Empréstimo registrado", {
        description: `${aluno?.nome} • devolver até ${fmtData(dataPrevista)}`,
      });
      setCodigo("");
      setAluno(null);
      setResultados(null);
      setTermo("");
      invalidar();
    },
    onError: (e) => toast.error("Empréstimo bloqueado", { description: e.message }),
  });

  const tituloDoExemplar = exemplar ? mapaTitulos.get(exemplar.titulo_id) : undefined;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Novo empréstimo</h3>

      <Label>Aluno (nome ou AlunoID do Sponte)</Label>
      <div className="mt-1 flex gap-2">
        <Input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && termo.trim()) buscarAlunos.mutate();
          }}
          placeholder="Ex.: Maria ou 12345"
          disabled={!podeEditar}
        />
        <Button
          variant="secondary"
          disabled={!termo.trim() || buscarAlunos.isPending || !podeEditar}
          onClick={() => buscarAlunos.mutate()}
        >
          {buscarAlunos.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </Button>
      </div>
      {resultados && !aluno && (
        <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-border text-sm">
          {resultados.length === 0 ? (
            <p className="p-2 text-muted-foreground">Nenhum aluno encontrado.</p>
          ) : (
            resultados.map((a) => (
              <button
                key={a.alunoId}
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-muted/50"
                onClick={() => setAluno(a)}
              >
                <span>{a.nome}</span>
                <span className="text-xs text-muted-foreground">
                  {a.turma || "—"} · #{a.alunoId}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {aluno && pend && (
        <div
          className={[
            "mt-2 rounded-lg border p-2 text-sm",
            pend.podeEmprestar
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700",
          ].join(" ")}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {aluno.nome}{" "}
              <span className="text-xs font-normal opacity-70">
                {aluno.turma || ""} · #{aluno.alunoId}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setAluno(null)}>
              Trocar
            </Button>
          </div>
          {pend.podeEmprestar ? (
            <p className="text-xs">Sem pendências — pode retirar um exemplar.</p>
          ) : (
            <ul className="text-xs">
              {pend.motivos.map((m) => (
                <li key={m}>
                  • {ROTULO_BLOQUEIO[m]}
                  {m === "multa_aberta" ? ` (${brl.format(pend.saldoMultas)})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3">
        <Label>Código do exemplar</Label>
        <div className="mt-1 flex gap-2">
          <Input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="12 dígitos da etiqueta"
            className="font-mono"
            disabled={!podeEditar}
          />
          <Button variant="secondary" onClick={() => setScanAberto(true)} disabled={!podeEditar}>
            <ScanBarcode className="mr-2 h-4 w-4" /> Ler
          </Button>
        </div>
        {codigo.trim() && (
          <p className="mt-1 text-xs">
            {exemplar ? (
              <>
                <span className="font-medium">{tituloDoExemplar?.titulo}</span>{" "}
                <StatusBadge status={exemplar.status} />
              </>
            ) : (
              <span className="text-destructive">Exemplar não encontrado nesta unidade.</span>
            )}
          </p>
        )}
      </div>

      <div className="mt-3">
        <Label>Devolver até</Label>
        <Input
          type="date"
          value={dataPrevista}
          min={hoje}
          onChange={(e) => setDataPrevista(e.target.value)}
          className="mt-1 w-48"
          disabled={!podeEditar}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          disabled={
            !podeEditar ||
            !aluno ||
            !exemplar ||
            !pend?.podeEmprestar ||
            exemplar.status !== "disponivel" ||
            emprestar.isPending
          }
          onClick={() => emprestar.mutate()}
        >
          {emprestar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Registrar empréstimo
        </Button>
      </div>

      <BarcodeScannerDialog
        open={scanAberto}
        onOpenChange={setScanAberto}
        titulo="Ler código do exemplar"
        descricao="Aponte a câmera para a etiqueta do livro. O código é preenchido e o leitor fecha."
        onCodigo={async (c) => {
          const ex = exemplares.find((e) => e.codigo === c);
          setCodigo(c);
          setScanAberto(false);
          return ex
            ? {
                ok: true,
                mensagem: `${mapaTitulos.get(ex.titulo_id)?.titulo ?? ""} — ${ROTULO_STATUS_EXEMPLAR[ex.status]}`,
              }
            : { ok: false, mensagem: "Exemplar não encontrado nesta unidade." };
        }}
      />
    </div>
  );
}

function Devolucao({ ctx }: { ctx: Ctx }) {
  const { schoolId, podeEditar, titulos, exemplares, emprestimos } = ctx;
  const invalidar = useInvalidar(schoolId);
  const { userId, nome } = useNomeUsuario();

  const [codigo, setCodigo] = useState("");
  const [perdido, setPerdido] = useState(false);
  const [multaPaga, setMultaPaga] = useState(false);
  const [scanAberto, setScanAberto] = useState(false);

  const hoje = hojeYMD();
  const mapaTitulos = useMemo(() => new Map(titulos.map((t) => [t.id, t])), [titulos]);
  const mapaEx = useMemo(() => new Map(exemplares.map((e) => [e.id, e])), [exemplares]);

  const emprestimo = useMemo(() => {
    const c = normalizarCodigoExemplar(codigo);
    if (!c) return null;
    const ex = exemplares.find((e) => e.codigo === c);
    if (!ex) return null;
    return emprestimos.find((e) => e.exemplar_id === ex.id && e.data_devolucao === null) ?? null;
  }, [codigo, exemplares, emprestimos]);

  const calc = emprestimo
    ? calcularDevolucao(
        emprestimo.data_prevista,
        hoje,
        valoresPara(ctx, emprestimo.data_emprestimo),
      )
    : null;

  const devolver = useMutation({
    mutationFn: async (alvo: Emprestimo) => {
      const r = calcularDevolucao(alvo.data_prevista, hoje, valoresPara(ctx, alvo.data_emprestimo));
      // Exemplar perdido: encerra sem multa em dinheiro (reposição física).
      const multa = perdido ? 0 : r.multa;
      const { error } = await supabase
        .from("biblioteca_emprestimos" as never)
        .update({
          data_devolucao: hoje,
          perdido,
          dias_atraso: perdido ? 0 : r.diasAtraso,
          multa_valor: multa,
          multa_paga_em: multa > 0 && multaPaga ? new Date().toISOString() : null,
          multa_paga_por_nome: multa > 0 && multaPaga ? nome : "",
          devolvido_por: userId,
          devolvido_por_nome: nome,
        } as never)
        .eq("id", alvo.id)
        .is("data_devolucao", null);
      if (error) throw error;
      const { error: e2 } = await supabase
        .from("biblioteca_exemplares" as never)
        .update({ status: perdido ? "perdido" : "disponivel" } as never)
        .eq("id", alvo.exemplar_id);
      if (e2) throw e2;
      return { r, multa };
    },
    onSuccess: ({ r, multa }, alvo) => {
      toast.success(perdido ? "Exemplar marcado como perdido" : "Devolução registrada", {
        description:
          multa > 0
            ? `${alvo.aluno_nome} • ${r.diasAtraso} dia(s) útil(eis) de atraso • multa ${brl.format(multa)}${multaPaga ? " (paga)" : " (em aberto)"}`
            : `${alvo.aluno_nome} • sem atraso`,
      });
      setCodigo("");
      setPerdido(false);
      setMultaPaga(false);
      invalidar();
    },
    onError: (e) => toast.error("Erro na devolução", { description: e.message }),
  });

  const ex = emprestimo ? mapaEx.get(emprestimo.exemplar_id) : undefined;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Undo2 className="h-4 w-4" /> Devolução
      </h3>
      <Label>Código do exemplar</Label>
      <div className="mt-1 flex gap-2">
        <Input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="12 dígitos da etiqueta"
          className="font-mono"
          disabled={!podeEditar}
        />
        <Button variant="secondary" onClick={() => setScanAberto(true)} disabled={!podeEditar}>
          <ScanBarcode className="mr-2 h-4 w-4" /> Ler
        </Button>
      </div>

      {codigo.trim() && !emprestimo && (
        <p className="mt-2 text-xs text-destructive">
          Nenhum empréstimo em aberto para este código nesta unidade.
        </p>
      )}

      {emprestimo && calc && (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <div>
            <p className="font-medium">{ex ? mapaTitulos.get(ex.titulo_id)?.titulo : ""}</p>
            <p className="text-xs text-muted-foreground">
              {emprestimo.aluno_nome} · {emprestimo.turma || "—"} · emprestado em{" "}
              {fmtData(emprestimo.data_emprestimo)} · previsto {fmtData(emprestimo.data_prevista)}
            </p>
          </div>
          {calc.diasAtraso > 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              <span>
                <strong>{calc.diasAtraso}</strong> dia(s) útil(eis) de atraso → multa{" "}
                <strong>{brl.format(calc.multa)}</strong> (R$2,00/dia útil, teto R$30,00)
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> Dentro do prazo — sem multa.
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={perdido} onCheckedChange={(v) => setPerdido(v === true)} />
            Exemplar perdido (sai de circulação; aluno repõe fisicamente, sem multa em dinheiro)
          </label>
          {!perdido && calc.multa > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={multaPaga} onCheckedChange={(v) => setMultaPaga(v === true)} />
              Multa paga agora em dinheiro ({brl.format(calc.multa)})
            </label>
          )}
          <div className="flex justify-end">
            <Button
              variant={perdido ? "destructive" : "default"}
              disabled={!podeEditar || devolver.isPending}
              onClick={() => devolver.mutate(emprestimo)}
            >
              {devolver.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {perdido ? "Registrar perda" : "Confirmar devolução"}
            </Button>
          </div>
        </div>
      )}

      <BarcodeScannerDialog
        open={scanAberto}
        onOpenChange={setScanAberto}
        titulo="Ler código para devolução"
        descricao="Aponte a câmera para a etiqueta do livro devolvido."
        onCodigo={async (c) => {
          setCodigo(c);
          setScanAberto(false);
          const e = exemplares.find((x) => x.codigo === c);
          const ab = e
            ? emprestimos.find((m) => m.exemplar_id === e.id && m.data_devolucao === null)
            : undefined;
          return ab
            ? { ok: true, mensagem: `${ab.aluno_nome} — confirme a devolução.` }
            : { ok: false, mensagem: "Nenhum empréstimo em aberto para este código." };
        }}
      />
    </div>
  );
}

function EmprestimosAbertos({ ctx }: { ctx: Ctx }) {
  const { titulos, exemplares, emprestimos } = ctx;
  const hoje = hojeYMD();
  const mapaTitulos = useMemo(() => new Map(titulos.map((t) => [t.id, t])), [titulos]);
  const mapaEx = useMemo(() => new Map(exemplares.map((e) => [e.id, e])), [exemplares]);
  const abertos = useMemo(
    () =>
      emprestimos
        .filter((e) => e.data_devolucao === null)
        .sort((a, b) => a.data_prevista.localeCompare(b.data_prevista)),
    [emprestimos],
  );

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Empréstimos em aberto ({abertos.length})</h3>
      {abertos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum exemplar emprestado no momento.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Aluno</th>
                <th className="px-3 py-2">Turma</th>
                <th className="px-3 py-2">Título</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Emprestado</th>
                <th className="px-3 py-2">Devolver até</th>
                <th className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {abertos.map((e) => {
                const ex = mapaEx.get(e.exemplar_id);
                const atrasado = emprestimoAtrasado(e, hoje);
                const c = atrasado
                  ? calcularDevolucao(e.data_prevista, hoje, valoresPara(ctx, e.data_emprestimo))
                  : null;
                return (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{e.aluno_nome}</td>
                    <td className="px-3 py-2">{e.turma || "—"}</td>
                    <td className="px-3 py-2">
                      {ex ? mapaTitulos.get(ex.titulo_id)?.titulo : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {ex ? formatarCodigoExemplar(ex.codigo) : "—"}
                    </td>
                    <td className="px-3 py-2">{fmtData(e.data_emprestimo)}</td>
                    <td className="px-3 py-2">{fmtData(e.data_prevista)}</td>
                    <td className="px-3 py-2">
                      {atrasado && c ? (
                        <Badge variant="destructive">
                          {c.diasAtraso} dia(s) útil(eis) · {brl.format(c.multa)}
                        </Badge>
                      ) : (
                        <Badge variant="outline">No prazo</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pendências: multas em aberto e atrasos, por aluno
// ---------------------------------------------------------------------------

function PendenciasTab({ ctx }: { ctx: Ctx }) {
  const { schoolId, podeEditar, titulos, exemplares, emprestimos } = ctx;
  const invalidar = useInvalidar(schoolId);
  const { nome } = useNomeUsuario();
  const hoje = hojeYMD();
  const [filtro, setFiltro] = useState<"pendentes" | "historico">("pendentes");

  const mapaTitulos = useMemo(() => new Map(titulos.map((t) => [t.id, t])), [titulos]);
  const mapaEx = useMemo(() => new Map(exemplares.map((e) => [e.id, e])), [exemplares]);
  const resumo = useMemo(() => resumirPendencias(emprestimos, hoje), [emprestimos, hoje]);
  const multasAbertas = useMemo(() => emprestimos.filter(multaEmAberto), [emprestimos]);
  const historico = useMemo(
    () => emprestimos.filter((e) => e.data_devolucao !== null).slice(0, 200),
    [emprestimos],
  );

  const pagarMulta = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("biblioteca_emprestimos" as never)
        .update({ multa_paga_em: new Date().toISOString(), multa_paga_por_nome: nome } as never)
        .eq("id", id)
        .is("multa_paga_em", null);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Multa marcada como paga");
      invalidar();
    },
    onError: (e) => toast.error("Erro ao quitar multa", { description: e.message }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Alunos com pendência ({resumo.length})</h3>
        {resumo.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum aluno com multa em aberto ou empréstimo atrasado.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Aluno</th>
                  <th className="px-3 py-2 text-right">Multas em aberto</th>
                  <th className="px-3 py-2 text-center">Empréstimos atrasados</th>
                </tr>
              </thead>
              <tbody>
                {resumo.map((r) => (
                  <tr key={r.aluno_id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      {r.aluno_nome}{" "}
                      <span className="text-xs text-muted-foreground">#{r.aluno_id}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.saldoMultas > 0 ? brl.format(r.saldoMultas) : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">{r.emprestimosAtrasados || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-semibold">
            {filtro === "pendentes"
              ? `Multas em aberto (${multasAbertas.length})`
              : `Histórico de devoluções (${historico.length})`}
          </h3>
          <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
            <SelectTrigger className="h-8 w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendentes">Multas em aberto</SelectItem>
              <SelectItem value="historico">Histórico de devoluções</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(filtro === "pendentes" ? multasAbertas : historico).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada por aqui.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Aluno</th>
                  <th className="px-3 py-2">Título</th>
                  <th className="px-3 py-2">Previsto</th>
                  <th className="px-3 py-2">Devolvido</th>
                  <th className="px-3 py-2 text-center">Dias úteis</th>
                  <th className="px-3 py-2 text-right">Multa</th>
                  <th className="px-3 py-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {(filtro === "pendentes" ? multasAbertas : historico).map((e) => {
                  const ex = mapaEx.get(e.exemplar_id);
                  return (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{e.aluno_nome}</td>
                      <td className="px-3 py-2">
                        {ex ? mapaTitulos.get(ex.titulo_id)?.titulo : "—"}
                        {e.perdido && (
                          <Badge variant="destructive" className="ml-2">
                            Perdido
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">{fmtData(e.data_prevista)}</td>
                      <td className="px-3 py-2">{fmtData(e.data_devolucao)}</td>
                      <td className="px-3 py-2 text-center">{e.dias_atraso || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {e.multa_valor > 0 ? brl.format(e.multa_valor) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {e.multa_valor === 0 ? (
                          <span className="text-xs text-muted-foreground">Sem multa</span>
                        ) : e.multa_paga_em ? (
                          <span className="text-xs text-emerald-700">
                            Paga em {fmtData(e.multa_paga_em.slice(0, 10))}
                            {e.multa_paga_por_nome ? ` · ${e.multa_paga_por_nome}` : ""}
                          </span>
                        ) : podeEditar ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pagarMulta.isPending}
                            onClick={() => pagarMulta.mutate(e.id)}
                          >
                            Marcar como paga
                          </Button>
                        ) : (
                          <Badge variant="destructive">Em aberto</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
