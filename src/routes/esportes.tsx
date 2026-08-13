import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dumbbell,
  Loader2,
  Percent,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { usePermissions, useAuth } from "@/lib/app-context";
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
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { supabase } from "@/integrations/supabase/client";
import { buscarAlunosSponte, type AlunoBuscaSponte } from "@/lib/sponte.functions";
import { fetchArrecadacaoModalidade } from "@/lib/esportes.functions";
import { rotuloMesReferencia } from "@/lib/billing-exceptions";

export const Route = createFileRoute("/esportes")({
  head: () => ({ meta: [{ title: "Esportes Extracurriculares — School Hub" }] }),
  component: EsportesGate,
});

function EsportesGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("esportes"))
    return (
      <AccessDenied message="Você não tem permissão para acessar Esportes Extracurriculares." />
    );
  return <EsportesPage />;
}

const UNIDADES_SPONTE = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

type Modalidade = {
  id: string;
  nome: string;
  categoria_sponte: string;
  parceiro_nome: string;
  percentual_parceiro: number;
  unidade: string;
};

type Matricula = {
  id: string;
  aluno_id: string;
  aluno_nome: string;
  turma: string;
};

type Repasse = {
  id: string;
  mes_referencia: string;
  valor_arrecadado: number;
  percentual_parceiro: number;
  valor_repasse: number;
  valor_retido: number;
  pago_em: string | null;
  created_by_nome: string;
};

function formatBRL(n: number): string {
  return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatData(ymd: string | null): string {
  if (!ymd) return "—";
  const [ano, mes, dia] = ymd.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function EsportesPage() {
  const { canEdit } = usePermissions();
  const { session } = useAuth();
  const qc = useQueryClient();

  const [modalidadeId, setModalidadeId] = useState<string>("");
  const [inicioMes, setInicioMes] = useState<string>(() => `${hojeYMD().slice(0, 7)}-01`);
  const mesReferencia = inicioMes.slice(0, 7);

  // O RLS já devolve somente as modalidades visíveis: o parceiro externo recebe
  // apenas as dele, então a tela não precisa (nem pode) filtrar por conta própria.
  const {
    data: modalidades = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["esportes_modalidades"],
    queryFn: async (): Promise<Modalidade[]> => {
      const { data, error } = await supabase
        .from("esportes_modalidades" as never)
        .select("id, nome, categoria_sponte, parceiro_nome, percentual_parceiro, unidade")
        .order("nome", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Modalidade[];
    },
  });

  // Parceiro externo = usuário com modalidades atribuídas em Gerenciar Acessos.
  // Ele só consulta; o cadastro e o registro de repasse são do colégio.
  const { data: minhasModalidades = [] } = useQuery({
    queryKey: ["esportes_meus_acessos", session?.user?.id],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("esportes_modalidade_acessos" as never)
        .select("modalidade_id")
        .eq("user_id", session?.user?.id ?? "");
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as { modalidade_id: string }[]).map((r) => r.modalidade_id);
    },
    enabled: !!session?.user?.id,
  });

  const ehParceiro = minhasModalidades.length > 0;
  const podeEditar = canEdit("esportes") && !ehParceiro;

  useEffect(() => {
    if (!modalidadeId && modalidades.length > 0) setModalidadeId(modalidades[0].id);
  }, [modalidades, modalidadeId]);

  const modalidade = useMemo(
    () => modalidades.find((m) => m.id === modalidadeId) ?? null,
    [modalidades, modalidadeId],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Dumbbell className="h-6 w-6 text-primary" /> Esportes Extracurriculares
        </h1>
        <p className="text-sm text-muted-foreground">
          Modalidades ministradas por parceiros externos: alunos matriculados, valor efetivamente
          pago na categoria da modalidade dentro do boleto do Sponte e repasse ao parceiro.
        </p>
      </div>

      {podeEditar && <CadastroModalidade onCriada={setModalidadeId} />}

      {isError ? (
        <div className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-red-600">
          Falha ao carregar as modalidades.
        </div>
      ) : isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : modalidades.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma modalidade disponível para você.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Modalidade</Label>
              <Select value={modalidadeId} onValueChange={setModalidadeId}>
                <SelectTrigger className="h-9 w-72">
                  <SelectValue placeholder="Selecione a modalidade" />
                </SelectTrigger>
                <SelectContent>
                  {modalidades.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome} — {m.parceiro_nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Mês</Label>
              <MonthYearPicker startDate={inicioMes} onChange={(start) => setInicioMes(start)} />
            </div>
            {modalidade && (
              <div className="ml-auto text-xs text-muted-foreground">
                Categoria no Sponte: <strong>{modalidade.categoria_sponte}</strong> ·{" "}
                {modalidade.unidade} · parceiro fica com{" "}
                <strong>{Number(modalidade.percentual_parceiro)}%</strong>
              </div>
            )}
          </div>

          {modalidade && (
            <>
              <PainelMensal
                modalidade={modalidade}
                mesReferencia={mesReferencia}
                podeEditar={podeEditar}
                onRepasseRegistrado={() =>
                  qc.invalidateQueries({ queryKey: ["esportes_repasses", modalidade.id] })
                }
              />
              <AlunosDaModalidade modalidade={modalidade} podeEditar={podeEditar} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// Cadastro da modalidade: parceiro responsável, percentual contratual e a
// categoria com que a mensalidade da modalidade é lançada no boleto do Sponte.
function CadastroModalidade({ onCriada }: { onCriada: (id: string) => void }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [parceiro, setParceiro] = useState("");
  const [percentual, setPercentual] = useState("");
  const [unidade, setUnidade] = useState("");

  const criar = useMutation({
    mutationFn: async (): Promise<Modalidade> => {
      const pct = Number(percentual.replace(",", "."));
      if (!nome.trim() || !parceiro.trim() || !unidade)
        throw new Error("Preencha todos os campos.");
      if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        throw new Error("Percentual do parceiro deve estar entre 0 e 100.");
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const { data, error } = await supabase
        .from("esportes_modalidades" as never)
        .insert({
          nome: nome.trim(),
          categoria_sponte: (categoria.trim() || nome.trim()) as string,
          parceiro_nome: parceiro.trim(),
          percentual_parceiro: pct,
          unidade,
          created_by: session?.user?.id ?? null,
          created_by_nome: meta?.full_name || session?.user?.email || "",
        } as never)
        .select("id, nome, categoria_sponte, parceiro_nome, percentual_parceiro, unidade")
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as Modalidade;
    },
    onSuccess: (m) => {
      toast.success("Modalidade cadastrada.");
      setNome("");
      setCategoria("");
      setParceiro("");
      setPercentual("");
      setUnidade("");
      qc.invalidateQueries({ queryKey: ["esportes_modalidades"] });
      onCriada(m.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao cadastrar."),
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plus className="h-4 w-4 text-primary" /> Nova modalidade
        </h2>
      </div>
      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Modalidade</Label>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex.: Jiu-Jitsu"
            className="h-9 w-44"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Categoria no boleto (Sponte)</Label>
          <Input
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            placeholder="igual ao nome, se vazio"
            className="h-9 w-52"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Parceiro responsável</Label>
          <Input
            value={parceiro}
            onChange={(e) => setParceiro(e.target.value)}
            placeholder="ex.: João da Silva"
            className="h-9 w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">% do parceiro</Label>
          <Input
            value={percentual}
            onChange={(e) => setPercentual(e.target.value)}
            placeholder="ex.: 70"
            className="h-9 w-24"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Unidade</Label>
          <Select value={unidade} onValueChange={setUnidade}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {UNIDADES_SPONTE.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button className="h-9 gap-1" disabled={criar.isPending} onClick={() => criar.mutate()}>
          <Plus className="h-4 w-4" />
          {criar.isPending ? "Salvando…" : "Cadastrar"}
        </Button>
      </div>
      <p className="border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        A categoria é o que identifica a mensalidade da modalidade dentro do boleto do aluno no
        Sponte (como “Material Pedagógico”). O valor arrecadado nunca é digitado aqui: ele é lido do
        Sponte, considerando somente o que foi <strong>efetivamente pago</strong>.
      </p>
    </div>
  );
}

// Painel do mês: valor pago por aluno, total arrecadado, repasse do parceiro,
// retido pelo colégio e a data em que a transferência foi feita.
function PainelMensal({
  modalidade,
  mesReferencia,
  podeEditar,
  onRepasseRegistrado,
}: {
  modalidade: Modalidade;
  mesReferencia: string;
  podeEditar: boolean;
  onRepasseRegistrado: () => void;
}) {
  const { session } = useAuth();
  const arrecadacaoFn = useServerFn(fetchArrecadacaoModalidade);
  const [pagoEm, setPagoEm] = useState<string>(() => hojeYMD());

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["esportes_arrecadacao", modalidade.id, mesReferencia],
    queryFn: () => arrecadacaoFn({ data: { modalidadeId: modalidade.id, mesReferencia } }),
  });

  const { data: repasse = null } = useQuery({
    queryKey: ["esportes_repasses", modalidade.id, mesReferencia],
    queryFn: async (): Promise<Repasse | null> => {
      const { data: row, error: err } = await supabase
        .from("esportes_repasses" as never)
        .select(
          "id, mes_referencia, valor_arrecadado, percentual_parceiro, valor_repasse, valor_retido, pago_em, created_by_nome",
        )
        .eq("modalidade_id", modalidade.id)
        .eq("mes_referencia", mesReferencia)
        .maybeSingle();
      if (err) throw new Error(err.message);
      return (row as unknown as Repasse | null) ?? null;
    },
  });

  const registrar = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("Aguarde o cálculo do mês.");
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const { error: err } = await supabase.from("esportes_repasses" as never).upsert(
        {
          modalidade_id: modalidade.id,
          mes_referencia: mesReferencia,
          valor_arrecadado: data.valorArrecadado,
          percentual_parceiro: data.percentualParceiro,
          valor_repasse: data.valorRepasse,
          valor_retido: data.valorRetido,
          pago_em: pagoEm,
          created_by: session?.user?.id ?? null,
          created_by_nome: meta?.full_name || session?.user?.email || "",
        } as never,
        { onConflict: "modalidade_id,mes_referencia" },
      );
      if (err) throw new Error(err.message);
    },
    onSuccess: () => {
      toast.success("Repasse registrado como transferido.");
      onRepasseRegistrado();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao registrar o repasse."),
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Wallet className="h-4 w-4 text-primary" /> {modalidade.nome} ·{" "}
          {rotuloMesReferencia(mesReferencia)}
        </h2>
        {isFetching && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> consultando o Sponte…
          </span>
        )}
      </div>

      {isError ? (
        <div className="px-4 py-6 text-sm text-red-600">
          {error instanceof Error ? error.message : "Falha ao calcular a arrecadação."}
        </div>
      ) : !data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <>
          {data.error && <div className="px-4 pt-3 text-sm text-red-600">{data.error}</div>}
          {data.avisos.length > 0 && (
            <div className="border-b border-border bg-amber-50 px-4 py-2 text-xs text-amber-800">
              Não foi possível ler o Sponte de {data.avisos.length} aluno(s) — o total abaixo está
              parcial: {data.avisos.join("; ")}
            </div>
          )}

          <div className="grid gap-3 px-4 py-3 sm:grid-cols-4">
            <Indicador label="Total arrecadado" valor={formatBRL(data.valorArrecadado)} />
            <Indicador
              label="% do parceiro"
              valor={`${data.percentualParceiro}%`}
              icone={<Percent className="h-4 w-4 text-muted-foreground" />}
            />
            <Indicador label="Repasse ao parceiro" valor={formatBRL(data.valorRepasse)} destaque />
            <Indicador label="Retido pelo colégio" valor={formatBRL(data.valorRetido)} />
          </div>

          <div className="flex flex-wrap items-center gap-3 border-y border-border bg-muted/30 px-4 py-3">
            {repasse?.pago_em ? (
              <span className="text-sm">
                Repasse transferido em <strong>{formatData(repasse.pago_em)}</strong> —{" "}
                {formatBRL(Number(repasse.valor_repasse))}
                {repasse.created_by_nome ? ` · registrado por ${repasse.created_by_nome}` : ""}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                Repasse ainda <strong>não transferido</strong> — o valor acima é o calculado.
              </span>
            )}
            {podeEditar && (
              <div className="ml-auto flex items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">Data da transferência</Label>
                  <Input
                    type="date"
                    value={pagoEm}
                    onChange={(e) => setPagoEm(e.target.value)}
                    className="h-9 w-40"
                  />
                </div>
                <Button
                  className="h-9 gap-1"
                  disabled={registrar.isPending}
                  onClick={() => registrar.mutate()}
                >
                  <Wallet className="h-4 w-4" />
                  {repasse?.pago_em ? "Atualizar repasse" : "Registrar repasse"}
                </Button>
              </div>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aluno</TableHead>
                <TableHead>AlunoID</TableHead>
                <TableHead className="text-right">Valor pago</TableHead>
                <TableHead>Pagamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.alunos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum aluno matriculado nesta modalidade.
                  </TableCell>
                </TableRow>
              ) : (
                data.alunos.map((a) => (
                  <TableRow key={a.alunoId}>
                    <TableCell className="text-sm font-medium">{a.alunoNome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.alunoId}</TableCell>
                    <TableCell className="text-right text-sm">{formatBRL(a.valorPago)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.dataPagamento ? formatData(a.dataPagamento) : "em aberto"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

function Indicador({
  label,
  valor,
  destaque,
  icone,
}: {
  label: string;
  valor: string;
  destaque?: boolean;
  icone?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icone}
        {label}
      </div>
      <div className={`text-lg font-semibold ${destaque ? "text-primary" : ""}`}>{valor}</div>
    </div>
  );
}

// Alunos matriculados na modalidade. A busca segue o padrão das outras telas:
// nome (3+ letras) ou AlunoID, direto no Sponte.
function AlunosDaModalidade({
  modalidade,
  podeEditar,
}: {
  modalidade: Modalidade;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const buscar = useServerFn(buscarAlunosSponte);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  const { data: matriculas = [] } = useQuery({
    queryKey: ["esportes_matriculas", modalidade.id],
    queryFn: async (): Promise<Matricula[]> => {
      const { data, error } = await supabase
        .from("esportes_matriculas" as never)
        .select("id, aluno_id, aluno_nome, turma")
        .eq("modalidade_id", modalidade.id)
        .order("aluno_nome", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Matricula[];
    },
  });

  const buscarAlunos = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: termo.trim(), unidade: modalidade.unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel)
        throw new Error(`Integração Sponte indisponível para "${modalidade.unidade}".`);
      return r.alunos;
    },
    onSuccess: (alunos) => {
      setErroBusca(null);
      setResultados(alunos);
    },
    onError: (e) => {
      setResultados(null);
      setErroBusca(e instanceof Error ? e.message : "Falha na busca.");
    },
  });

  const vincular = useMutation({
    mutationFn: async (aluno: AlunoBuscaSponte) => {
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const { error } = await supabase.from("esportes_matriculas" as never).upsert(
        {
          modalidade_id: modalidade.id,
          aluno_id: aluno.alunoId,
          aluno_nome: aluno.nome,
          turma: aluno.turma ?? "",
          created_by: session?.user?.id ?? null,
          created_by_nome: meta?.full_name || session?.user?.email || "",
        } as never,
        { onConflict: "modalidade_id,aluno_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Aluno vinculado à modalidade.");
      setResultados(null);
      setTermo("");
      qc.invalidateQueries({ queryKey: ["esportes_matriculas", modalidade.id] });
      qc.invalidateQueries({ queryKey: ["esportes_arrecadacao", modalidade.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao vincular o aluno."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("esportes_matriculas" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Aluno removido da modalidade.");
      qc.invalidateQueries({ queryKey: ["esportes_matriculas", modalidade.id] });
      qc.invalidateQueries({ queryKey: ["esportes_arrecadacao", modalidade.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover o aluno."),
  });

  const t = termo.trim();
  const termoValido = /^\d+$/.test(t) ? t.length >= 1 : t.length >= 3;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Users className="h-4 w-4 text-primary" /> Alunos matriculados
        </h2>
        <span className="text-xs text-muted-foreground">
          {matriculas.length} aluno(s) em {modalidade.nome}
        </span>
      </div>

      {podeEditar && (
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="esportes-busca" className="text-[11px] text-muted-foreground">
                Aluno (nome ou AlunoID do Sponte) · {modalidade.unidade}
              </Label>
              <Input
                id="esportes-busca"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && termoValido) buscarAlunos.mutate();
                }}
                placeholder="ex.: Giovanna ou 554"
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

          {erroBusca && <div className="text-xs text-red-600">{erroBusca}</div>}

          {resultados && resultados.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Nenhum aluno encontrado para “{t}” em {modalidade.unidade}.
            </div>
          )}

          {resultados && resultados.length > 0 && (
            <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {resultados.map((a) => (
                <div key={a.alunoId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{a.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    AlunoID {a.alunoId}
                    {a.turma ? ` · ${a.turma}` : ""}
                    {a.situacao ? ` · ${a.situacao}` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-8 gap-1"
                    disabled={vincular.isPending}
                    onClick={() => vincular.mutate(a)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Vincular
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {matriculas.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Nenhum aluno vinculado a esta modalidade.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aluno</TableHead>
              <TableHead>AlunoID</TableHead>
              <TableHead>Turma</TableHead>
              {podeEditar && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {matriculas.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-sm font-medium">{m.aluno_nome || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{m.aluno_id}</TableCell>
                <TableCell className="text-sm">{m.turma || "—"}</TableCell>
                {podeEditar && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-600 hover:bg-red-50"
                      title="Remover aluno da modalidade"
                      disabled={remover.isPending}
                      onClick={() => remover.mutate(m.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
