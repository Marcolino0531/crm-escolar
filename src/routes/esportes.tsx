import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Dumbbell,
  Loader2,
  Pencil,
  Percent,
  Plus,
  Save,
  Search,
  Settings,
  Trash2,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { usePermissions, useAuth, useSchool } from "@/lib/app-context";
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
import { fetchArrecadacaoModalidade, fetchParcelasModalidade } from "@/lib/esportes.functions";
import {
  dataPrevistaRepasse,
  normalizarDias,
  parcelasDoMes,
  resumoParcelas,
  rotuloDias,
  somaPercentuais,
  somaValoresFixos,
  vezesPorSemana,
  type ParcelaAlunoModalidade,
  type ParceiroModalidade,
  type TipoRepasse,
} from "@/lib/esportes-repasse";
import { WEEKDAYS } from "@/lib/diario";
import {
  agruparPorUnidade,
  modalidadesDaUnidade,
  podeOperarModalidade,
  selecaoValida,
  unidadeDaSelecao,
  unidadeParaCadastro,
} from "@/lib/esportes-unidades";
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

const COLUNAS_MODALIDADE =
  "id, nome, categoria_sponte, tipo_repasse, dia_pagamento, mes_inicio, unidade";
const COLUNAS_PARCEIRO = "id, nome, percentual_parceiro, valor_fixo_mensal, ordem, ativo";
const COLUNAS_TURMA = "id, nome, hora_inicio, hora_fim, ordem, ativo";

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
  // Turma escolar do aluno no Sponte ("2º Ano T / B"), não a turma da modalidade.
  turma: string;
  frequencia_id: string | null;
  turma_id: string | null;
  dias_semana: number[] | null;
  // Data da matrícula NA MODALIDADE (YYYY-MM-DD), editável na tela.
  data_matricula: string | null;
};

// Turma da modalidade = HORÁRIO da aula ("Fundamental 1 e 2", 18h30–19h10).
type Turma = {
  id: string;
  nome: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  ordem: number;
  ativo: boolean;
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

function formatarHora(hora: string | null): string {
  return hora ? hora.slice(0, 5) : "";
}

// Horário da turma como a professora fala: "17h40 às 18h20".
function rotuloHorario(turma: Turma): string {
  const i = formatarHora(turma.hora_inicio);
  const f = formatarHora(turma.hora_fim);
  if (!i && !f) return "";
  if (i && f) return `${i.replace(":", "h")} às ${f.replace(":", "h")}`;
  return (i || f).replace(":", "h");
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
  const { selected, schools } = useSchool();

  // Unidade selecionada no topo. `null` = "Todas as Unidades", que aqui é uma
  // visão consolidada somente leitura: cada modalidade pertence a UMA unidade.
  const unidadeAtiva = useMemo(() => unidadeDaSelecao(selected, schools), [selected, schools]);

  const [modalidadeId, setModalidadeId] = useState<string>("");
  const [inicioMes, setInicioMes] = useState<string>(() => `${hojeYMD().slice(0, 7)}-01`);
  const mesReferencia = inicioMes.slice(0, 7);
  // Parceiros/repasse e turmas mudam pouco: ficam fora da tela do dia a dia.
  const [configAberta, setConfigAberta] = useState(false);

  // O RLS já devolve somente as modalidades visíveis: o parceiro externo recebe
  // apenas as dele, então a tela não precisa (nem pode) filtrar por conta própria.
  const {
    data: todasModalidades = [],
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
  const podeEditarModulo = canEdit("esportes") && !ehParceiro;

  // Só as modalidades da unidade ativa; no consolidado, nenhuma é operável.
  const modalidades = useMemo(
    () => modalidadesDaUnidade(todasModalidades, unidadeAtiva),
    [todasModalidades, unidadeAtiva],
  );

  // Trocar a unidade no topo descarta a modalidade da unidade anterior.
  useEffect(() => {
    const valida = selecaoValida(todasModalidades, unidadeAtiva, modalidadeId);
    if (valida !== modalidadeId) setModalidadeId(valida);
  }, [todasModalidades, unidadeAtiva, modalidadeId]);

  const modalidade = useMemo(
    () => modalidades.find((m) => m.id === modalidadeId) ?? null,
    [modalidades, modalidadeId],
  );

  const podeEditar = podeOperarModalidade(modalidade, unidadeAtiva, podeEditarModulo);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Dumbbell className="h-6 w-6 text-primary" /> Esportes Extracurriculares
        </h1>
        <p className="text-sm text-muted-foreground">
          Modalidades ministradas por parceiros externos: alunos matriculados, valor efetivamente
          pago na categoria da modalidade dentro do boleto do Sponte e repasse ao parceiro. Cada
          unidade tem as suas próprias modalidades, com turmas, alunos e parceiros separados.
        </p>
      </div>

      {podeEditarModulo && unidadeAtiva && (
        <CadastroModalidade unidade={unidadeAtiva} onCriada={setModalidadeId} />
      )}

      {isError ? (
        <div className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-red-600">
          Falha ao carregar as modalidades.
        </div>
      ) : isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !unidadeAtiva ? (
        <ConsolidadoUnidades modalidades={todasModalidades} />
      ) : modalidades.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma modalidade cadastrada em <strong>{unidadeAtiva}</strong>.
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
            {modalidade && (
              <Button
                variant="outline"
                className="h-9 gap-1"
                onClick={() => setConfigAberta((v) => !v)}
                title="Parceiros, repasse e turmas da modalidade"
              >
                <Settings className="h-4 w-4" /> Configurações da Modalidade
                {configAberta ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            )}
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

          {modalidade && configAberta && (
            <div className="space-y-4 rounded-xl border border-dashed border-primary/40 bg-muted/20 p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Mês do acompanhamento de repasse
                  </Label>
                  <MonthYearPicker
                    startDate={inicioMes}
                    onChange={(start) => setInicioMes(start)}
                  />
                </div>
                <Button variant="ghost" size="sm" onClick={() => setConfigAberta(false)}>
                  Fechar configurações
                </Button>
              </div>
              <PainelMensal
                modalidade={modalidade}
                mesReferencia={mesReferencia}
                podeEditar={podeEditar}
              />
              <ParceirosDaModalidade modalidade={modalidade} podeEditar={podeEditar} />
              <TurmasDaModalidade modalidade={modalidade} podeEditar={podeEditar} />
            </div>
          )}

          {modalidade && (
            <>
              <AlunosDaModalidade modalidade={modalidade} podeEditar={podeEditar} />
              <RelacaoDeValores modalidade={modalidade} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// Visão consolidada de "Todas as Unidades": só leitura. Lista as modalidades de
// todas as unidades, cada uma rotulada com a sua — nada é operado daqui, porque
// turmas, alunos, parceiros e parcelas pertencem a uma unidade específica.
function ConsolidadoUnidades({ modalidades }: { modalidades: Modalidade[] }) {
  const grupos = useMemo(() => agruparPorUnidade(modalidades), [modalidades]);

  const { data: matriculasPorModalidade = {} } = useQuery({
    queryKey: ["esportes_matriculas_contagem"],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("esportes_matriculas" as never)
        .select("modalidade_id");
      if (error) throw new Error(error.message);
      const contagem: Record<string, number> = {};
      for (const row of (data ?? []) as unknown as { modalidade_id: string }[]) {
        contagem[row.modalidade_id] = (contagem[row.modalidade_id] ?? 0) + 1;
      }
      return contagem;
    },
  });

  if (grupos.length === 0)
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        Nenhuma modalidade disponível para você.
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        Visão consolidada de todas as unidades, <strong>somente leitura</strong>. Para cadastrar,
        matricular alunos ou alterar turmas e repasse, selecione a unidade no topo da tela.
      </div>

      {grupos.map((g) => (
        <div key={g.unidade} className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Dumbbell className="h-4 w-4 text-primary" /> {g.unidade}
              <span className="text-xs font-normal text-muted-foreground">
                {g.modalidades.length} modalidade{g.modalidades.length === 1 ? "" : "s"}
              </span>
            </h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modalidade</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Categoria no Sponte</TableHead>
                <TableHead>Repasse</TableHead>
                <TableHead className="text-right">Alunos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.modalidades.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{m.unidade}</TableCell>
                  <TableCell className="text-muted-foreground">{m.categoria_sponte}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.tipo_repasse === "fixo"
                      ? `valor fixo mensal${m.dia_pagamento ? ` · dia ${m.dia_pagamento}` : ""}`
                      : "percentual do arrecadado"}
                  </TableCell>
                  <TableCell className="text-right">{matriculasPorModalidade[m.id] ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
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
// A unidade vem do seletor do topo, não do formulário: a modalidade nasce
// pertencendo à unidade em que está sendo cadastrada, e nunca fica "solta".
function CadastroModalidade({
  unidade,
  onCriada,
}: {
  unidade: string;
  onCriada: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { session } = useAuth();
  // Cadastrar modalidade é eventual: o formulário nasce recolhido para a tela
  // abrir na lista de modalidades já existentes.
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tipo, setTipo] = useState<TipoRepasse>("percentual");
  const [diaPagamento, setDiaPagamento] = useState("");
  const [mesInicio, setMesInicio] = useState("");
  const [linhas, setLinhas] = useState<ParceiroForm[]>([
    { nome: "", percentual: "", valorFixo: "" },
  ]);

  // Trocar de unidade no topo muda a unidade de destino do cadastro: recolhe
  // para ninguém continuar preenchendo um formulário de outra unidade.
  useEffect(() => {
    setAberto(false);
  }, [unidade]);

  const criar = useMutation({
    mutationFn: async (): Promise<Modalidade> => {
      if (!nome.trim()) throw new Error("Informe o nome da modalidade.");
      const unidadeDestino = unidadeParaCadastro(unidade);
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
          unidade: unidadeDestino,
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
      setTipo("percentual");
      setDiaPagamento("");
      setMesInicio("");
      setLinhas([{ nome: "", percentual: "", valorFixo: "" }]);
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["esportes_modalidades"] });
      onCriada(m.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao cadastrar."),
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left ${
          aberto ? "border-b border-border" : ""
        }`}
      >
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plus className="h-4 w-4 text-primary" /> Nova modalidade em {unidade}
        </h2>
        {aberto ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {aberto && (
        <>
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
                <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                  {unidade}
                </div>
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
            A modalidade pertence à unidade selecionada no topo da tela (<strong>{unidade}</strong>)
            e só aparece nela. A categoria é o que identifica a mensalidade da modalidade dentro do
            boleto do aluno no Sponte (como “Material Pedagógico”). O valor arrecadado nunca é
            digitado aqui: ele é lido do Sponte, considerando somente o que foi{" "}
            <strong>efetivamente pago</strong>. No repasse <strong>fixo</strong>, o parceiro recebe
            o valor combinado todo mês independentemente do que foi arrecadado — a diferença fica
            com o colégio, para mais ou para menos.
          </p>
        </>
      )}
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
  detalhe,
}: {
  label: string;
  valor: string;
  destaque?: boolean;
  negativo?: boolean;
  icone?: React.ReactNode;
  detalhe?: string;
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
      {detalhe && <div className="text-[11px] text-muted-foreground">{detalhe}</div>}
    </div>
  );
}

// "Relação de valores": as parcelas reais da categoria da modalidade no boleto
// de cada aluno, lidas do Sponte a cada abertura da tela. O School Hub não
// guarda nem recalcula esses valores — a parcela proporcional do mês em que o
// aluno entrou aparece exatamente como está no Sponte.
function RelacaoDeValores({ modalidade }: { modalidade: Modalidade }) {
  const buscarParcelas = useServerFn(fetchParcelasModalidade);
  // Filtro de mês próprio da seção: a consulta ao Sponte traz o ano todo de uma
  // vez (uma chamada por aluno), e trocar o mês só refiltra o que já está em memória.
  const [inicioMes, setInicioMes] = useState<string>(() => `${hojeYMD().slice(0, 7)}-01`);
  const mesReferencia = inicioMes.slice(0, 7);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["esportes_parcelas", modalidade.id],
    queryFn: () => buscarParcelas({ data: { modalidadeId: modalidade.id } }),
  });

  const doMes = useMemo(
    () => parcelasDoMes(data?.parcelas ?? [], mesReferencia),
    [data, mesReferencia],
  );
  const resumo = useMemo(() => resumoParcelas(doMes), [doMes]);

  // Total de matriculados na modalidade, só para acusar divergência: aluno
  // matriculado sem parcela no mês é lançamento que ficou faltando no Sponte.
  const { data: matriculas = [] } = useQuery({
    queryKey: ["esportes_matriculas", modalidade.id],
    queryFn: () => carregarMatriculas(modalidade.id),
  });
  const matriculados = matriculas.length;

  // Uma linha por parcela do mês, agrupada por aluno.
  const porAluno = useMemo(() => {
    const grupos = new Map<string, { nome: string; parcelas: ParcelaAlunoModalidade[] }>();
    for (const p of doMes) {
      const atual = grupos.get(p.alunoId) ?? { nome: p.alunoNome, parcelas: [] };
      atual.parcelas.push(p);
      grupos.set(p.alunoId, atual);
    }
    return [...grupos.entries()].sort((a, b) => a[1].nome.localeCompare(b[1].nome, "pt-BR"));
  }, [doMes]);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Wallet className="h-4 w-4 text-primary" /> Relação de valores
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Parcelas da categoria &ldquo;{modalidade.categoria_sponte}&rdquo; no boleto de cada
            aluno, direto do Sponte.
          </span>
          <MonthYearPicker startDate={inicioMes} onChange={(start) => setInicioMes(start)} />
        </div>
      </div>

      {isError ? (
        <div className="px-4 py-6 text-sm text-red-600">Falha ao consultar o Sponte.</div>
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
              Não foi possível ler o Sponte de {data.avisos.length} aluno(s) — a relação está
              parcial: {data.avisos.join("; ")}
            </div>
          )}

          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador label="Quitado" valor={formatBRL(resumo.quitado)} />
            <Indicador
              label="Vencido"
              valor={formatBRL(resumo.vencido)}
              negativo={resumo.vencido > 0}
            />
            <Indicador label="A vencer" valor={formatBRL(resumo.aVencer)} />
            <Indicador
              label="Quantidade de boletos"
              valor={String(resumo.quantidade)}
              negativo={matriculados > 0 && resumo.alunos < matriculados}
              detalhe={`${resumo.alunos} de ${matriculados} aluno(s) matriculado(s) com parcela`}
            />
          </div>

          {porAluno.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              Nenhuma parcela da categoria &ldquo;{modalidade.categoria_sponte}&rdquo; em{" "}
              {rotuloMesReferencia(mesReferencia)} para os alunos matriculados.
            </div>
          ) : (
            porAluno.map(([alunoId, grupo]) => (
              <div key={alunoId}>
                <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-4 py-2">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-semibold">{grupo.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    · AlunoID {alunoId} · {grupo.parcelas.length} parcela(s)
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Parcela</TableHead>
                      <TableHead className="w-40">Vencimento</TableHead>
                      <TableHead className="w-32 text-right">Valor</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grupo.parcelas.map((p) => (
                      <TableRow key={`${p.numeroParcela}-${p.vencimento}`}>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.numeroParcela || "—"}
                        </TableCell>
                        <TableCell className="text-sm">{formatData(p.vencimento)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatBRL(p.valor)}
                        </TableCell>
                        <TableCell>
                          <SeloSituacao parcela={p} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

function SeloSituacao({ parcela }: { parcela: ParcelaAlunoModalidade }) {
  if (parcela.situacao === "quitado") {
    return (
      <span className="text-sm text-emerald-700">
        Quitado
        {parcela.dataPagamento ? ` em ${formatData(parcela.dataPagamento)}` : ""}
      </span>
    );
  }
  if (parcela.situacao === "vencido") {
    return <span className="text-sm font-medium text-red-600">Vencido</span>;
  }
  return <span className="text-sm text-muted-foreground">A vencer</span>;
}

async function carregarTurmas(modalidadeId: string): Promise<Turma[]> {
  const { data, error } = await supabase
    .from("esportes_turmas" as never)
    .select(COLUNAS_TURMA)
    .eq("modalidade_id", modalidadeId)
    .order("ordem", { ascending: true })
    .order("hora_inicio", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Turma[];
}

async function carregarMatriculas(modalidadeId: string): Promise<Matricula[]> {
  const { data, error } = await supabase
    .from("esportes_matriculas" as never)
    .select("id, aluno_id, aluno_nome, turma, frequencia_id, turma_id, dias_semana, data_matricula")
    .eq("modalidade_id", modalidadeId)
    .order("aluno_nome", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Matricula[];
}

// Turmas (horários) da modalidade. Diferente da frequência: a turma diz QUANDO a
// aula acontece e para quem, a frequência diz QUANTOS dias o aluno faz e quanto
// custa.
function TurmasDaModalidade({
  modalidade,
  podeEditar,
}: {
  modalidade: Modalidade;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [nome, setNome] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  // Turma sendo editada na própria linha, com um rascunho à parte para o Cancelar
  // não deixar meia edição gravada.
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState({ nome: "", inicio: "", fim: "" });

  const { data: turmas = [] } = useQuery({
    queryKey: ["esportes_turmas", modalidade.id],
    queryFn: () => carregarTurmas(modalidade.id),
  });

  const abrirEdicao = (t: Turma) => {
    setEditando(t.id);
    setRascunho({
      nome: t.nome,
      inicio: formatarHora(t.hora_inicio),
      fim: formatarHora(t.hora_fim),
    });
  };

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["esportes_turmas", modalidade.id] });
    qc.invalidateQueries({ queryKey: ["esportes_matriculas", modalidade.id] });
  };

  const criar = useMutation({
    mutationFn: async () => {
      if (!nome.trim()) throw new Error("Informe o nome da turma.");
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const { error } = await supabase.from("esportes_turmas" as never).insert({
        modalidade_id: modalidade.id,
        nome: nome.trim(),
        hora_inicio: inicio || null,
        hora_fim: fim || null,
        ordem: turmas.length,
        created_by: session?.user?.id ?? null,
        created_by_nome: meta?.full_name || session?.user?.email || "",
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Turma adicionada.");
      setNome("");
      setInicio("");
      setFim("");
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar a turma."),
  });

  // Editar nome/horário é UPDATE da turma: os alunos seguem vinculados por
  // `turma_id`, então nada precisa ser revinculado.
  const salvarEdicao = useMutation({
    mutationFn: async (id: string) => {
      if (!rascunho.nome.trim()) throw new Error("Informe o nome da turma.");
      const { error } = await supabase
        .from("esportes_turmas" as never)
        .update({
          nome: rascunho.nome.trim(),
          hora_inicio: rascunho.inicio || null,
          hora_fim: rascunho.fim || null,
        } as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Turma atualizada.");
      setEditando(null);
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar a turma."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("esportes_turmas" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Turma removida.");
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover a turma."),
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Clock className="h-4 w-4 text-primary" /> Turmas e horários
        </h2>
        <span className="text-xs text-muted-foreground">
          A turma é o horário da aula; os dias de cada aluno ficam na matrícula dele.
        </span>
      </div>

      {turmas.length === 0 ? (
        <div className="px-4 py-4 text-sm text-muted-foreground">
          Nenhuma turma cadastrada — os alunos ficam sem horário definido.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Turma</TableHead>
              <TableHead className="w-64">Horário</TableHead>
              {podeEditar && <TableHead className="w-40" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {turmas.map((t) => {
              const emEdicao = editando === t.id;
              const ocupado = salvarEdicao.isPending || remover.isPending;
              return (
                <TableRow key={t.id}>
                  <TableCell className="text-sm font-medium">
                    {emEdicao ? (
                      <Input
                        value={rascunho.nome}
                        onChange={(e) => setRascunho((r) => ({ ...r, nome: e.target.value }))}
                        className="h-9"
                        aria-label="Nome da turma"
                      />
                    ) : (
                      t.nome
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {emEdicao ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={rascunho.inicio}
                          onChange={(e) => setRascunho((r) => ({ ...r, inicio: e.target.value }))}
                          className="h-9 w-28"
                          aria-label="Horário de início da turma"
                        />
                        <span className="text-muted-foreground">às</span>
                        <Input
                          type="time"
                          value={rascunho.fim}
                          onChange={(e) => setRascunho((r) => ({ ...r, fim: e.target.value }))}
                          className="h-9 w-28"
                          aria-label="Horário de fim da turma"
                        />
                      </div>
                    ) : (
                      rotuloHorario(t) || "—"
                    )}
                  </TableCell>
                  {podeEditar && (
                    <TableCell>
                      {emEdicao ? (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            className="h-8 gap-1"
                            disabled={ocupado}
                            onClick={() => salvarEdicao.mutate(t.id)}
                          >
                            <Save className="h-3.5 w-3.5" /> Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={ocupado}
                            onClick={() => setEditando(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title="Editar nome e horário da turma"
                            disabled={ocupado}
                            onClick={() => abrirEdicao(t)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-600 hover:bg-red-50"
                            title="Remover turma (os alunos ficam sem turma definida)"
                            disabled={ocupado}
                            onClick={() => remover.mutate(t.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {podeEditar && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border px-4 py-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="turma-nome" className="text-[11px] text-muted-foreground">
              Nova turma
            </Label>
            <Input
              id="turma-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="ex.: Fundamental 1 e 2"
              className="h-9 w-72"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="turma-inicio" className="text-[11px] text-muted-foreground">
              Início
            </Label>
            <Input
              id="turma-inicio"
              type="time"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="h-9 w-28"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="turma-fim" className="text-[11px] text-muted-foreground">
              Fim
            </Label>
            <Input
              id="turma-fim"
              type="time"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className="h-9 w-28"
            />
          </div>
          <Button
            variant="outline"
            className="h-9 gap-1"
            disabled={criar.isPending}
            onClick={() => criar.mutate()}
          >
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
      )}
    </div>
  );
}

// Dias da semana clicáveis, no mesmo padrão visual do card de frequência do
// Diário do Aluno (inclusive a mesma lista de dias úteis).
function DiasSemanaPicker({
  dias,
  desabilitado,
  onToggle,
}: {
  dias: number[];
  desabilitado: boolean;
  onToggle: (dia: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAYS.map((d) => {
        const ativo = dias.includes(d.value);
        return (
          <button
            key={d.value}
            type="button"
            disabled={desabilitado}
            onClick={() => onToggle(d.value)}
            className={[
              "flex h-9 w-11 items-center justify-center rounded-lg text-xs font-semibold transition disabled:opacity-50",
              ativo
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-secondary text-muted-foreground hover:bg-secondary/70",
            ].join(" ")}
            aria-pressed={ativo}
            aria-label={d.long}
          >
            {d.short}
          </button>
        );
      })}
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
  // Turma e dias usados ao vincular os alunos encontrados na busca.
  const [turmaNova, setTurmaNova] = useState<string>("");
  const [diasNovos, setDiasNovos] = useState<number[]>([]);
  // Visão da lista: por turma e por dia, para a professora saber quem esperar.
  const [filtroTurma, setFiltroTurma] = useState<string>("todas");
  const [filtroDia, setFiltroDia] = useState<string>("todos");

  const { data: turmas = [] } = useQuery({
    queryKey: ["esportes_turmas", modalidade.id],
    queryFn: () => carregarTurmas(modalidade.id),
  });

  const turmasAtivas = useMemo(() => turmas.filter((t) => t.ativo), [turmas]);

  useEffect(() => {
    if (!turmaNova && turmasAtivas.length > 0) setTurmaNova(turmasAtivas[0].id);
  }, [turmaNova, turmasAtivas]);

  const { data: matriculas = [] } = useQuery({
    queryKey: ["esportes_matriculas", modalidade.id],
    queryFn: () => carregarMatriculas(modalidade.id),
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
          turma_id: turmaNova || null,
          dias_semana: normalizarDias(diasNovos),
          // Dia de hoje em BRT: o default do banco (`current_date`) roda em UTC
          // e viraria o dia seguinte num cadastro feito à noite.
          data_matricula: hojeYMD(),
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
      invalidarMatriculas();
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
      invalidarMatriculas();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover o aluno."),
  });

  // Trocar de turma ou de dias é um UPDATE da matrícula: o aluno não precisa ser
  // removido e recadastrado (o vínculo e o histórico dele continuam os mesmos).
  const atualizarMatricula = useMutation({
    mutationFn: async ({
      id,
      turmaId,
      dias,
      dataMatricula,
    }: {
      id: string;
      turmaId?: string | null;
      dias?: number[];
      dataMatricula?: string;
    }) => {
      const patch: {
        turma_id?: string | null;
        dias_semana?: number[];
        data_matricula?: string;
      } = {};
      if (turmaId !== undefined) patch.turma_id = turmaId || null;
      if (dias !== undefined) patch.dias_semana = normalizarDias(dias);
      if (dataMatricula !== undefined) patch.data_matricula = dataMatricula;
      const { error } = await supabase
        .from("esportes_matriculas" as never)
        .update(patch as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidarMatriculas(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar o aluno."),
  });

  function invalidarMatriculas() {
    qc.invalidateQueries({ queryKey: ["esportes_matriculas", modalidade.id] });
    qc.invalidateQueries({ queryKey: ["esportes_arrecadacao", modalidade.id] });
  }

  const dias = (m: Matricula) => normalizarDias(m.dias_semana);

  const alternarDia = (m: Matricula, dia: number) => {
    const atuais = dias(m);
    const proximos = atuais.includes(dia) ? atuais.filter((d) => d !== dia) : [...atuais, dia];
    atualizarMatricula.mutate({ id: m.id, dias: proximos });
  };

  const visiveis = useMemo(() => {
    const dia = filtroDia === "todos" ? null : Number(filtroDia);
    return matriculas.filter((m) => {
      if (filtroTurma === "sem-turma" && m.turma_id) return false;
      if (filtroTurma !== "todas" && filtroTurma !== "sem-turma" && m.turma_id !== filtroTurma)
        return false;
      if (dia !== null && !normalizarDias(m.dias_semana).includes(dia)) return false;
      return true;
    });
  }, [matriculas, filtroTurma, filtroDia]);

  // Grupos na ordem do cadastro das turmas, com "Sem turma" no fim para não
  // esconder aluno que ainda não foi encaixado em nenhum horário.
  const grupos = useMemo(() => {
    const porTurma = turmas.map((t) => ({
      chave: t.id,
      titulo: t.nome,
      horario: rotuloHorario(t),
      alunos: visiveis.filter((m) => m.turma_id === t.id),
    }));
    const semTurma = visiveis.filter(
      (m) => !m.turma_id || !turmas.some((t) => t.id === m.turma_id),
    );
    if (semTurma.length > 0) {
      porTurma.push({ chave: "sem-turma", titulo: "Sem turma", horario: "", alunos: semTurma });
    }
    return porTurma.filter((g) => g.alunos.length > 0);
  }, [turmas, visiveis]);

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
            {turmasAtivas.length > 0 && (
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-muted-foreground">Turma (horário)</Label>
                <Select value={turmaNova} onValueChange={setTurmaNova}>
                  <SelectTrigger className="h-9 w-72">
                    <SelectValue placeholder="Selecione a turma" />
                  </SelectTrigger>
                  <SelectContent>
                    {turmasAtivas.map((tu) => (
                      <SelectItem key={tu.id} value={tu.id}>
                        {tu.nome}
                        {rotuloHorario(tu) ? ` · ${rotuloHorario(tu)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">
                Dias da semana
                {diasNovos.length > 0 ? ` · ${vezesPorSemana(diasNovos)}x/semana` : ""}
              </Label>
              <DiasSemanaPicker
                dias={diasNovos}
                desabilitado={false}
                onToggle={(d) =>
                  setDiasNovos((atuais) =>
                    atuais.includes(d) ? atuais.filter((x) => x !== d) : [...atuais, d],
                  )
                }
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

      {matriculas.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">Ver turma</Label>
            <Select value={filtroTurma} onValueChange={setFiltroTurma}>
              <SelectTrigger className="h-9 w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as turmas</SelectItem>
                {turmas.map((tu) => (
                  <SelectItem key={tu.id} value={tu.id}>
                    {tu.nome}
                    {rotuloHorario(tu) ? ` · ${rotuloHorario(tu)}` : ""}
                  </SelectItem>
                ))}
                <SelectItem value="sem-turma">Sem turma</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">Ver dia</Label>
            <Select value={filtroDia} onValueChange={setFiltroDia}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os dias</SelectItem>
                {WEEKDAYS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.long}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="pb-2 text-xs text-muted-foreground">
            {visiveis.length} de {matriculas.length} aluno(s)
          </span>
        </div>
      )}

      {matriculas.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Nenhum aluno vinculado a esta modalidade.
        </div>
      ) : grupos.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Nenhum aluno neste filtro de turma/dia.
        </div>
      ) : (
        grupos.map((g) => (
          <div key={g.chave}>
            <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-4 py-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-semibold">{g.titulo}</span>
              {g.horario && <span className="text-xs text-muted-foreground">{g.horario}</span>}
              <span className="text-xs text-muted-foreground">· {g.alunos.length} aluno(s)</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead className="w-44">Data de Matrícula</TableHead>
                  <TableHead className="w-64">Turma (horário)</TableHead>
                  <TableHead className="w-72">Dias</TableHead>
                  {podeEditar && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.alunos.map((m) => {
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="text-sm font-medium">{m.aluno_nome || "—"}</TableCell>
                      <TableCell>
                        {podeEditar ? (
                          <Input
                            type="date"
                            className="h-9 w-36"
                            value={m.data_matricula ?? ""}
                            disabled={atualizarMatricula.isPending}
                            onChange={(e) =>
                              e.target.value &&
                              atualizarMatricula.mutate({ id: m.id, dataMatricula: e.target.value })
                            }
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {formatData(m.data_matricula)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {podeEditar && turmas.length > 0 ? (
                          <Select
                            value={m.turma_id ?? ""}
                            onValueChange={(v) =>
                              atualizarMatricula.mutate({ id: m.id, turmaId: v })
                            }
                            disabled={atualizarMatricula.isPending}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Sem turma" />
                            </SelectTrigger>
                            <SelectContent>
                              {turmas.map((tu) => (
                                <SelectItem key={tu.id} value={tu.id}>
                                  {tu.nome}
                                  {rotuloHorario(tu) ? ` · ${rotuloHorario(tu)}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm">
                            {turmas.find((tu) => tu.id === m.turma_id)?.nome ?? "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {podeEditar ? (
                          <DiasSemanaPicker
                            dias={dias(m)}
                            desabilitado={atualizarMatricula.isPending}
                            onToggle={(d) => alternarDia(m, d)}
                          />
                        ) : (
                          <span className="text-sm">{rotuloDias(m.dias_semana) || "—"}</span>
                        )}
                      </TableCell>
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
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ))
      )}
    </div>
  );
}
