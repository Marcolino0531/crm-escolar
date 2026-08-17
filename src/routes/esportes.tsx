import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarClock,
  Dumbbell,
  Loader2,
  Pencil,
  Percent,
  Plus,
  Save,
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
import {
  dataPrevistaRepasse,
  somaPercentuais,
  somaValoresFixos,
  type ParceiroModalidade,
  type TipoRepasse,
} from "@/lib/esportes-repasse";
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

const COLUNAS_MODALIDADE =
  "id, nome, categoria_sponte, tipo_repasse, dia_pagamento, mes_inicio, unidade";
const COLUNAS_PARCEIRO = "id, nome, percentual_parceiro, valor_fixo_mensal, ordem, ativo";

type Modalidade = {
  id: string;
  nome: string;
  categoria_sponte: string;
  tipo_repasse: TipoRepasse;
  dia_pagamento: number | null;
  mes_inicio: string | null;
  unidade: string;
};

type Parceiro = {
  id: string;
  nome: string;
  percentual_parceiro: number | null;
  valor_fixo_mensal: number | null;
  ordem: number;
  ativo: boolean;
};

// Linha do formulário de parceiros (criação e edição): valores como texto, para
// aceitar "1.200,00" digitado à brasileira antes de virar número.
type ParceiroForm = { nome: string; percentual: string; valorFixo: string };

type Matricula = {
  id: string;
  aluno_id: string;
  aluno_nome: string;
  turma: string;
};

type Repasse = {
  id: string;
  mes_referencia: string;
  parceiro_id: string | null;
  valor_arrecadado: number;
  percentual_parceiro: number | null;
  valor_repasse: number;
  valor_retido: number;
  valor_ajustado: number | null;
  pago_em: string | null;
  observacao: string;
  created_by_nome: string;
};

const COLUNAS_REPASSE =
  "id, mes_referencia, parceiro_id, valor_arrecadado, percentual_parceiro, valor_repasse, valor_retido, valor_ajustado, pago_em, observacao, created_by_nome";

// Aceita "1.200,00", "1200.00" e "1200".
function parseValorBR(texto: string): number {
  const limpo = texto.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return Number(limpo);
}

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
        .select(COLUNAS_MODALIDADE)
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
                      {m.nome} — {m.tipo_repasse === "fixo" ? "valor fixo" : "percentual"}
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
                {modalidade.unidade} · repasse{" "}
                <strong>
                  {modalidade.tipo_repasse === "fixo" ? "em valor fixo mensal" : "percentual"}
                </strong>
                {modalidade.tipo_repasse === "fixo" && modalidade.dia_pagamento
                  ? ` · pagamento no dia ${modalidade.dia_pagamento}`
                  : ""}
                {modalidade.mes_inicio
                  ? ` · desde ${rotuloMesReferencia(modalidade.mes_inicio)}`
                  : ""}
              </div>
            )}
          </div>

          {modalidade && (
            <>
              <PainelMensal
                modalidade={modalidade}
                mesReferencia={mesReferencia}
                podeEditar={podeEditar}
              />
              <ParceirosDaModalidade modalidade={modalidade} podeEditar={podeEditar} />
              <AlunosDaModalidade modalidade={modalidade} podeEditar={podeEditar} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// Linhas de parceiro compartilhadas pelo cadastro e pela edição da modalidade.
// O campo que aparece depende do tipo de repasse: percentual ou valor fixo.
function LinhasParceiros({
  tipo,
  linhas,
  onChange,
  disabled,
}: {
  tipo: TipoRepasse;
  linhas: ParceiroForm[];
  onChange: (linhas: ParceiroForm[]) => void;
  disabled?: boolean;
}) {
  const alterar = (i: number, campo: keyof ParceiroForm, valor: string) => {
    onChange(linhas.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
  };

  const soma =
    tipo === "percentual"
      ? somaPercentuais(paraParceirosCalculo(tipo, linhas))
      : somaValoresFixos(paraParceirosCalculo(tipo, linhas));

  return (
    <div className="space-y-2">
      {linhas.map((l, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            {i === 0 && <Label className="text-[11px] text-muted-foreground">Parceiro</Label>}
            <Input
              value={l.nome}
              onChange={(e) => alterar(i, "nome", e.target.value)}
              placeholder="ex.: João da Silva (professor)"
              className="h-9 w-56"
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            {i === 0 && (
              <Label className="text-[11px] text-muted-foreground">
                {tipo === "percentual" ? "% do parceiro" : "Valor fixo mensal (R$)"}
              </Label>
            )}
            {tipo === "percentual" ? (
              <Input
                value={l.percentual}
                onChange={(e) => alterar(i, "percentual", e.target.value)}
                placeholder="ex.: 70"
                className="h-9 w-28"
                disabled={disabled}
              />
            ) : (
              <Input
                value={l.valorFixo}
                onChange={(e) => alterar(i, "valorFixo", e.target.value)}
                placeholder="ex.: 1.200,00"
                className="h-9 w-36"
                disabled={disabled}
              />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-red-600 hover:bg-red-50"
            title="Remover este parceiro"
            disabled={disabled || linhas.length === 1}
            onClick={() => onChange(linhas.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={disabled}
          onClick={() => onChange([...linhas, { nome: "", percentual: "", valorFixo: "" }])}
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar parceiro
        </Button>
        <span
          className={`text-xs ${
            tipo === "percentual" && soma > 100 ? "text-red-600" : "text-muted-foreground"
          }`}
        >
          {tipo === "percentual"
            ? `Soma dos percentuais: ${soma}% (o colégio retém ${arredondar2(100 - soma)}%)`
            : `Total fixo mensal: ${formatBRL(soma)}`}
        </span>
      </div>
    </div>
  );
}

function arredondar2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Linhas do formulário na forma que a regra de cálculo entende.
function paraParceirosCalculo(tipo: TipoRepasse, linhas: ParceiroForm[]): ParceiroModalidade[] {
  return linhas.map((l, i) => ({
    id: String(i),
    nome: l.nome.trim(),
    percentualParceiro: tipo === "percentual" ? parseValorBR(l.percentual) || 0 : null,
    valorFixoMensal: tipo === "fixo" ? parseValorBR(l.valorFixo) || 0 : null,
  }));
}

// Valida as linhas e devolve o que vai para o banco (ou uma mensagem de erro).
function validarParceiros(
  tipo: TipoRepasse,
  linhas: ParceiroForm[],
): { nome: string; percentual_parceiro: number | null; valor_fixo_mensal: number | null }[] {
  const preenchidas = linhas.filter((l) => l.nome.trim().length > 0);
  if (preenchidas.length === 0) throw new Error("Cadastre ao menos um parceiro.");

  const nomes = new Set<string>();
  const saida = preenchidas.map((l) => {
    const nome = l.nome.trim();
    if (nomes.has(nome.toLowerCase()))
      throw new Error(`O parceiro "${nome}" está repetido na modalidade.`);
    nomes.add(nome.toLowerCase());

    if (tipo === "percentual") {
      const pct = parseValorBR(l.percentual);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        throw new Error(`Percentual de "${nome}" deve estar entre 0 e 100.`);
      return { nome, percentual_parceiro: pct, valor_fixo_mensal: null };
    }

    const valor = parseValorBR(l.valorFixo);
    if (!Number.isFinite(valor) || valor < 0) throw new Error(`Valor fixo de "${nome}" inválido.`);
    return { nome, percentual_parceiro: null, valor_fixo_mensal: valor };
  });

  if (tipo === "percentual" && somaPercentuais(paraParceirosCalculo(tipo, preenchidas)) > 100)
    throw new Error("A soma dos percentuais dos parceiros não pode passar de 100%.");

  return saida;
}

// Cadastro da modalidade: um ou mais parceiros, forma de repasse (percentual do
// arrecadado ou valor fixo mensal garantido) e a categoria com que a mensalidade
// da modalidade é lançada no boleto do Sponte.
function CadastroModalidade({ onCriada }: { onCriada: (id: string) => void }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [unidade, setUnidade] = useState("");
  const [tipo, setTipo] = useState<TipoRepasse>("percentual");
  const [diaPagamento, setDiaPagamento] = useState("");
  const [mesInicio, setMesInicio] = useState("");
  const [linhas, setLinhas] = useState<ParceiroForm[]>([
    { nome: "", percentual: "", valorFixo: "" },
  ]);

  const criar = useMutation({
    mutationFn: async (): Promise<Modalidade> => {
      if (!nome.trim() || !unidade) throw new Error("Preencha modalidade e unidade.");
      const parceiros = validarParceiros(tipo, linhas);

      const dia = diaPagamento.trim() ? Number(diaPagamento) : null;
      if (tipo === "fixo") {
        if (dia === null) throw new Error("Informe o dia de pagamento do repasse fixo.");
        if (!Number.isInteger(dia) || dia < 1 || dia > 31)
          throw new Error("Dia de pagamento deve estar entre 1 e 31.");
      }
      if (mesInicio && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mesInicio))
        throw new Error("Mês/ano de início inválido.");

      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const autor = meta?.full_name || session?.user?.email || "";

      const { data, error } = await supabase
        .from("esportes_modalidades" as never)
        .insert({
          nome: nome.trim(),
          categoria_sponte: (categoria.trim() || nome.trim()) as string,
          tipo_repasse: tipo,
          dia_pagamento: tipo === "fixo" ? dia : null,
          mes_inicio: mesInicio || null,
          unidade,
          created_by: session?.user?.id ?? null,
          created_by_nome: autor,
        } as never)
        .select(COLUNAS_MODALIDADE)
        .single();
      if (error) throw new Error(error.message);
      const criada = data as unknown as Modalidade;

      const { error: errParc } = await supabase.from("esportes_parceiros" as never).insert(
        parceiros.map((p, i) => ({
          modalidade_id: criada.id,
          ...p,
          ordem: i,
          created_by: session?.user?.id ?? null,
          created_by_nome: autor,
        })) as never,
      );
      if (errParc) {
        // Modalidade sem parceiro não calcula repasse nenhum: desfaz para não
        // deixar um cadastro pela metade na tela.
        await supabase
          .from("esportes_modalidades" as never)
          .delete()
          .eq("id", criada.id);
        throw new Error(errParc.message);
      }

      return criada;
    },
    onSuccess: (m) => {
      toast.success("Modalidade cadastrada.");
      setNome("");
      setCategoria("");
      setUnidade("");
      setTipo("percentual");
      setDiaPagamento("");
      setMesInicio("");
      setLinhas([{ nome: "", percentual: "", valorFixo: "" }]);
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
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
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
            <Label className="text-[11px] text-muted-foreground">
              Categoria no boleto (Sponte)
            </Label>
            <Input
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="igual ao nome, se vazio"
              className="h-9 w-52"
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
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">Tipo de repasse</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoRepasse)}>
              <SelectTrigger className="h-9 w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentual">Percentual do arrecadado</SelectItem>
                <SelectItem value="fixo">Valor fixo mensal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {tipo === "fixo" && (
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Dia de pagamento</Label>
              <Input
                value={diaPagamento}
                onChange={(e) => setDiaPagamento(e.target.value)}
                placeholder="ex.: 10"
                className="h-9 w-24"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">Início (mês/ano)</Label>
            <Input
              type="month"
              value={mesInicio}
              onChange={(e) => setMesInicio(e.target.value)}
              className="h-9 w-40"
            />
          </div>
        </div>

        <LinhasParceiros tipo={tipo} linhas={linhas} onChange={setLinhas} />

        <Button className="h-9 gap-1" disabled={criar.isPending} onClick={() => criar.mutate()}>
          <Plus className="h-4 w-4" />
          {criar.isPending ? "Salvando…" : "Cadastrar"}
        </Button>
      </div>
      <p className="border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        A categoria é o que identifica a mensalidade da modalidade dentro do boleto do aluno no
        Sponte (como “Material Pedagógico”). O valor arrecadado nunca é digitado aqui: ele é lido do
        Sponte, considerando somente o que foi <strong>efetivamente pago</strong>. No repasse{" "}
        <strong>fixo</strong>, o parceiro recebe o valor combinado todo mês independentemente do que
        foi arrecadado — a diferença fica com o colégio, para mais ou para menos.
      </p>
    </div>
  );
}

// Parceiros e forma de repasse da modalidade selecionada. Fica separado do
// cadastro porque muda com o tempo: entra um auxiliar, o valor fixo é
// renegociado, a modalidade passa de percentual para fixo.
function ParceirosDaModalidade({
  modalidade,
  podeEditar,
}: {
  modalidade: Modalidade;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [editando, setEditando] = useState(false);
  const [tipo, setTipo] = useState<TipoRepasse>(modalidade.tipo_repasse);
  const [diaPagamento, setDiaPagamento] = useState(
    modalidade.dia_pagamento ? String(modalidade.dia_pagamento) : "",
  );
  const [mesInicio, setMesInicio] = useState(modalidade.mes_inicio ?? "");
  const [linhas, setLinhas] = useState<(ParceiroForm & { id?: string })[]>([]);

  const { data: parceiros = [], isLoading } = useQuery({
    queryKey: ["esportes_parceiros", modalidade.id],
    queryFn: async (): Promise<Parceiro[]> => {
      const { data, error } = await supabase
        .from("esportes_parceiros" as never)
        .select(COLUNAS_PARCEIRO)
        .eq("modalidade_id", modalidade.id)
        .order("ordem", { ascending: true })
        .order("nome", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Parceiro[];
    },
  });

  // Sai do modo de edição (e recarrega os campos) ao trocar de modalidade.
  useEffect(() => {
    setEditando(false);
    setTipo(modalidade.tipo_repasse);
    setDiaPagamento(modalidade.dia_pagamento ? String(modalidade.dia_pagamento) : "");
    setMesInicio(modalidade.mes_inicio ?? "");
  }, [modalidade.id, modalidade.tipo_repasse, modalidade.dia_pagamento, modalidade.mes_inicio]);

  const abrirEdicao = () => {
    setLinhas(
      parceiros.map((p) => ({
        id: p.id,
        nome: p.nome,
        percentual: p.percentual_parceiro === null ? "" : String(Number(p.percentual_parceiro)),
        valorFixo: p.valor_fixo_mensal === null ? "" : String(Number(p.valor_fixo_mensal)),
      })),
    );
    setEditando(true);
  };

  const salvar = useMutation({
    mutationFn: async () => {
      const validados = validarParceiros(
        tipo,
        linhas.map((l) => ({ nome: l.nome, percentual: l.percentual, valorFixo: l.valorFixo })),
      );

      const dia = diaPagamento.trim() ? Number(diaPagamento) : null;
      if (tipo === "fixo") {
        if (dia === null) throw new Error("Informe o dia de pagamento do repasse fixo.");
        if (!Number.isInteger(dia) || dia < 1 || dia > 31)
          throw new Error("Dia de pagamento deve estar entre 1 e 31.");
      }
      if (mesInicio && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mesInicio))
        throw new Error("Mês/ano de início inválido.");

      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const autor = meta?.full_name || session?.user?.email || "";

      const { error: errMod } = await supabase
        .from("esportes_modalidades" as never)
        .update({
          tipo_repasse: tipo,
          dia_pagamento: tipo === "fixo" ? dia : null,
          mes_inicio: mesInicio || null,
        } as never)
        .eq("id", modalidade.id);
      if (errMod) throw new Error(errMod.message);

      // As linhas com nome preenchido são a nova lista; o resto sai.
      const comNome = linhas.filter((l) => l.nome.trim().length > 0);
      const removidos = parceiros
        .filter((p) => !comNome.some((l) => l.id === p.id))
        .map((p) => p.id);

      for (let i = 0; i < comNome.length; i++) {
        const dados = { ...validados[i], ordem: i };
        const linha = comNome[i];
        if (linha.id) {
          const { error } = await supabase
            .from("esportes_parceiros" as never)
            .update(dados as never)
            .eq("id", linha.id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabase.from("esportes_parceiros" as never).insert({
            modalidade_id: modalidade.id,
            ...dados,
            created_by: session?.user?.id ?? null,
            created_by_nome: autor,
          } as never);
          if (error) throw new Error(error.message);
        }
      }

      if (removidos.length > 0) {
        const { error } = await supabase
          .from("esportes_parceiros" as never)
          .delete()
          .in("id", removidos);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Parceiros e repasse atualizados.");
      setEditando(false);
      qc.invalidateQueries({ queryKey: ["esportes_parceiros", modalidade.id] });
      qc.invalidateQueries({ queryKey: ["esportes_modalidades"] });
      qc.invalidateQueries({ queryKey: ["esportes_arrecadacao", modalidade.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar."),
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Users className="h-4 w-4 text-primary" /> Parceiros e repasse
        </h2>
        {podeEditar && !editando && (
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={abrirEdicao}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="p-4">
          <Skeleton className="h-9 w-full" />
        </div>
      ) : editando ? (
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Tipo de repasse</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoRepasse)}>
                <SelectTrigger className="h-9 w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentual">Percentual do arrecadado</SelectItem>
                  <SelectItem value="fixo">Valor fixo mensal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipo === "fixo" && (
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-muted-foreground">Dia de pagamento</Label>
                <Input
                  value={diaPagamento}
                  onChange={(e) => setDiaPagamento(e.target.value)}
                  placeholder="ex.: 10"
                  className="h-9 w-24"
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Início (mês/ano)</Label>
              <Input
                type="month"
                value={mesInicio}
                onChange={(e) => setMesInicio(e.target.value)}
                className="h-9 w-40"
              />
            </div>
          </div>

          <LinhasParceiros tipo={tipo} linhas={linhas} onChange={setLinhas} />

          <div className="flex items-center gap-2">
            <Button
              className="h-9 gap-1"
              disabled={salvar.isPending}
              onClick={() => salvar.mutate()}
            >
              <Save className="h-4 w-4" />
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              variant="outline"
              className="h-9"
              disabled={salvar.isPending}
              onClick={() => setEditando(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parceiro</TableHead>
                <TableHead className="text-right">
                  {modalidade.tipo_repasse === "fixo" ? "Valor fixo mensal" : "% do arrecadado"}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parceiros.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum parceiro cadastrado nesta modalidade.
                  </TableCell>
                </TableRow>
              ) : (
                parceiros.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm font-medium">{p.nome}</TableCell>
                    <TableCell className="text-right text-sm">
                      {modalidade.tipo_repasse === "fixo"
                        ? formatBRL(Number(p.valor_fixo_mensal ?? 0))
                        : `${Number(p.percentual_parceiro ?? 0)}%`}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <p className="flex items-start gap-1.5 border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {modalidade.tipo_repasse === "fixo"
                ? `Repasse fixo garantido${
                    modalidade.dia_pagamento ? `, pago no dia ${modalidade.dia_pagamento}` : ""
                  }. Janeiro nunca gera repasse (colégio fechado)${
                    modalidade.mes_inicio
                      ? `, e meses anteriores a ${rotuloMesReferencia(modalidade.mes_inicio)} também não`
                      : ""
                  }.`
                : "Repasse percentual: cada parceiro leva o percentual do que foi efetivamente arrecadado no mês."}
            </span>
          </p>
        </>
      )}
    </div>
  );
}

// Painel do mês: valor pago por aluno, total arrecadado, repasse de cada
// parceiro, saldo do colégio e a data em que cada transferência foi feita.
function PainelMensal({
  modalidade,
  mesReferencia,
  podeEditar,
}: {
  modalidade: Modalidade;
  mesReferencia: string;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const arrecadacaoFn = useServerFn(fetchArrecadacaoModalidade);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["esportes_arrecadacao", modalidade.id, mesReferencia],
    queryFn: () => arrecadacaoFn({ data: { modalidadeId: modalidade.id, mesReferencia } }),
  });

  const { data: repasses = [] } = useQuery({
    queryKey: ["esportes_repasses", modalidade.id, mesReferencia],
    queryFn: async (): Promise<Repasse[]> => {
      const { data: rows, error: err } = await supabase
        .from("esportes_repasses" as never)
        .select(COLUNAS_REPASSE)
        .eq("modalidade_id", modalidade.id)
        .eq("mes_referencia", mesReferencia);
      if (err) throw new Error(err.message);
      return (rows ?? []) as unknown as Repasse[];
    },
  });

  const porParceiro = useMemo(() => {
    const mapa = new Map<string, Repasse>();
    for (const r of repasses) if (r.parceiro_id) mapa.set(r.parceiro_id, r);
    return mapa;
  }, [repasses]);

  const ehFixo = modalidade.tipo_repasse === "fixo";
  const dataPrevista = dataPrevistaRepasse(mesReferencia, modalidade.dia_pagamento);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["esportes_repasses", modalidade.id, mesReferencia] });
    qc.invalidateQueries({ queryKey: ["esportes_arrecadacao", modalidade.id, mesReferencia] });
  };

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
      ) : data.statusMes !== "ativo" ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          {data.statusMes === "janeiro"
            ? "Janeiro não gera repasse: o colégio não funciona neste mês."
            : `A modalidade começou em ${rotuloMesReferencia(
                modalidade.mes_inicio ?? "",
              )} — meses anteriores não geram repasse.`}
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

          <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
            <Indicador label="Total arrecadado" valor={formatBRL(data.valorArrecadado)} />
            <Indicador
              label={ehFixo ? "Total fixo aos parceiros" : "Repasse aos parceiros"}
              valor={formatBRL(data.totalRepasse)}
              destaque
              icone={ehFixo ? undefined : <Percent className="h-4 w-4 text-muted-foreground" />}
            />
            <Indicador
              label={ehFixo ? "Saldo do colégio na modalidade" : "Retido pelo colégio"}
              valor={formatBRL(data.saldoColegio)}
              negativo={data.saldoColegio < 0}
            />
          </div>

          {ehFixo && (
            <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              {data.saldoColegio < 0
                ? `O arrecadado não cobriu o valor fixo: o colégio complementou ${formatBRL(
                    Math.abs(data.saldoColegio),
                  )} do próprio bolso.`
                : `O arrecadado cobriu o valor fixo e sobraram ${formatBRL(
                    data.saldoColegio,
                  )} para o colégio.`}
              {dataPrevista ? ` Pagamento previsto para ${formatData(dataPrevista)}.` : ""}
            </p>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parceiro</TableHead>
                <TableHead className="text-right">
                  {ehFixo ? "Valor fixo" : "% do arrecadado"}
                </TableHead>
                <TableHead className="text-right">Valor do mês</TableHead>
                <TableHead>Transferido em</TableHead>
                {podeEditar && <TableHead className="w-[320px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.parceiros.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={podeEditar ? 5 : 4}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Nenhum parceiro cadastrado nesta modalidade.
                  </TableCell>
                </TableRow>
              ) : (
                data.parceiros.map((p) => (
                  <LinhaRepasseParceiro
                    key={p.parceiroId}
                    modalidadeId={modalidade.id}
                    mesReferencia={mesReferencia}
                    ehFixo={ehFixo}
                    calculo={p}
                    repasse={porParceiro.get(p.parceiroId) ?? null}
                    valorArrecadado={data.valorArrecadado}
                    saldoColegio={data.saldoColegio}
                    podeEditar={podeEditar}
                    onSalvo={invalidar}
                  />
                ))
              )}
            </TableBody>
          </Table>

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

// Uma linha por parceiro: o valor do mês, o ajuste manual (quando o mês foi
// parcial) e o registro da transferência.
function LinhaRepasseParceiro({
  modalidadeId,
  mesReferencia,
  ehFixo,
  calculo,
  repasse,
  valorArrecadado,
  saldoColegio,
  podeEditar,
  onSalvo,
}: {
  modalidadeId: string;
  mesReferencia: string;
  ehFixo: boolean;
  calculo: {
    parceiroId: string;
    parceiroNome: string;
    percentualParceiro: number | null;
    valorPadrao: number;
    valorRepasse: number;
    ajustadoManualmente: boolean;
  };
  repasse: Repasse | null;
  valorArrecadado: number;
  saldoColegio: number;
  podeEditar: boolean;
  onSalvo: () => void;
}) {
  const { session } = useAuth();
  const [pagoEm, setPagoEm] = useState<string>(() => repasse?.pago_em ?? hojeYMD());
  const [ajuste, setAjuste] = useState("");
  const [motivo, setMotivo] = useState("");
  const [editandoAjuste, setEditandoAjuste] = useState(false);

  const autor = () => {
    const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
    return meta?.full_name || session?.user?.email || "";
  };

  const upsert = async (extra: Record<string, unknown>) => {
    const { error } = await supabase.from("esportes_repasses" as never).upsert(
      {
        modalidade_id: modalidadeId,
        mes_referencia: mesReferencia,
        parceiro_id: calculo.parceiroId,
        valor_arrecadado: valorArrecadado,
        percentual_parceiro: calculo.percentualParceiro ?? 0,
        valor_repasse: calculo.valorRepasse,
        // Snapshot do que ficou com o colégio na modalidade no fechamento: no
        // fixo pode ser negativo (o colégio completou a diferença).
        valor_retido: saldoColegio,
        created_by: session?.user?.id ?? null,
        created_by_nome: autor(),
        ...extra,
      } as never,
      { onConflict: "modalidade_id,mes_referencia,parceiro_id" },
    );
    if (error) throw new Error(error.message);
  };

  const registrar = useMutation({
    mutationFn: () => upsert({ pago_em: pagoEm }),
    onSuccess: () => {
      toast.success(`Repasse de ${calculo.parceiroNome} registrado como transferido.`);
      onSalvo();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao registrar o repasse."),
  });

  const salvarAjuste = useMutation({
    mutationFn: async () => {
      const valor = parseValorBR(ajuste);
      if (!Number.isFinite(valor) || valor < 0) throw new Error("Valor do ajuste inválido.");
      // valor_repasse acompanha o ajuste: é ele que será efetivamente pago.
      await upsert({
        valor_ajustado: valor,
        valor_repasse: valor,
        observacao: motivo.trim(),
      });
    },
    onSuccess: () => {
      toast.success("Valor do mês ajustado.");
      setEditandoAjuste(false);
      onSalvo();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao ajustar o valor."),
  });

  const limparAjuste = useMutation({
    mutationFn: () =>
      upsert({ valor_ajustado: null, valor_repasse: calculo.valorPadrao, observacao: "" }),
    onSuccess: () => {
      toast.success("Ajuste removido: voltou ao valor do cadastro.");
      setEditandoAjuste(false);
      onSalvo();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover o ajuste."),
  });

  const ocupado = registrar.isPending || salvarAjuste.isPending || limparAjuste.isPending;

  return (
    <TableRow>
      <TableCell className="text-sm font-medium">{calculo.parceiroNome}</TableCell>
      <TableCell className="text-right text-sm">
        {ehFixo ? formatBRL(calculo.valorPadrao) : `${calculo.percentualParceiro ?? 0}%`}
      </TableCell>
      <TableCell className="text-right text-sm">
        <div className="flex flex-col items-end">
          <span className={calculo.ajustadoManualmente ? "font-semibold text-amber-700" : ""}>
            {formatBRL(calculo.valorRepasse)}
          </span>
          {calculo.ajustadoManualmente && (
            <span
              className="text-[11px] text-amber-700"
              title={
                repasse?.observacao
                  ? `Ajustado manualmente: ${repasse.observacao}`
                  : `Ajustado manualmente (padrão: ${formatBRL(calculo.valorPadrao)})`
              }
            >
              ajustado neste mês
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {repasse?.pago_em ? formatData(repasse.pago_em) : "não transferido"}
      </TableCell>
      {podeEditar && (
        <TableCell>
          {editandoAjuste ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-muted-foreground">Valor deste mês (R$)</Label>
                <Input
                  value={ajuste}
                  onChange={(e) => setAjuste(e.target.value)}
                  placeholder={String(calculo.valorPadrao)}
                  className="h-8 w-28"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-muted-foreground">Motivo</Label>
                <Input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="ex.: começou dia 15"
                  className="h-8 w-40"
                />
              </div>
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={ocupado}
                onClick={() => salvarAjuste.mutate()}
              >
                <Save className="h-3.5 w-3.5" /> Salvar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={ocupado}
                onClick={() => setEditandoAjuste(false)}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end justify-end gap-2">
              {ehFixo && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  disabled={ocupado}
                  onClick={() => {
                    setAjuste(
                      repasse?.valor_ajustado !== null && repasse?.valor_ajustado !== undefined
                        ? String(Number(repasse.valor_ajustado))
                        : String(calculo.valorPadrao),
                    );
                    setMotivo(repasse?.observacao ?? "");
                    setEditandoAjuste(true);
                  }}
                  title="Ajustar o valor apenas neste mês, sem mudar o cadastro"
                >
                  <Pencil className="h-3.5 w-3.5" /> Ajustar mês
                </Button>
              )}
              {calculo.ajustadoManualmente && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-red-600 hover:bg-red-50"
                  disabled={ocupado}
                  onClick={() => limparAjuste.mutate()}
                  title="Voltar ao valor do cadastro neste mês"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Input
                type="date"
                value={pagoEm}
                onChange={(e) => setPagoEm(e.target.value)}
                className="h-8 w-36"
              />
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={ocupado}
                onClick={() => registrar.mutate()}
              >
                <Wallet className="h-3.5 w-3.5" />
                {repasse?.pago_em ? "Atualizar" : "Registrar"}
              </Button>
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

function Indicador({
  label,
  valor,
  destaque,
  negativo,
  icone,
}: {
  label: string;
  valor: string;
  destaque?: boolean;
  negativo?: boolean;
  icone?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icone}
        {label}
      </div>
      <div
        className={`text-lg font-semibold ${
          negativo ? "text-red-600" : destaque ? "text-primary" : ""
        }`}
      >
        {valor}
      </div>
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
