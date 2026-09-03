// Análises com IA do Financeiro — acesso real aos dados (server-only).
//
// Aqui vivem: a checagem de permissão, o escopo de unidades do usuário e a
// implementação da `FonteDadosFinanceiros` sobre Supabase e Sponte. As saídas
// são DTOs próprios da análise: nenhuma linha crua de tabela ou payload do
// Sponte sai daqui, justamente para não vazar dado cadastral.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/supabase-paginate";
import type { FonteDadosModulos } from "@/lib/analises-ia-modulos";
import { criarFonteDadosModulos } from "@/lib/analises-ia-modulos.server";
import {
  competencia,
  type DespesaFluxo,
  type FiltroPeriodo,
  type FonteDadosFinanceiros,
  type InadimplenciaAgregada,
  type LancamentoExtrato,
  type ReceitaPrevista,
  type ReceitaRealizada,
  type SerieRecorrente,
  type StatusDespesa,
} from "@/lib/financeiro-ia";
import {
  allowedSponteUnidades,
  coletarInadimplenciaPorEscopo,
  UNIDADES_SPONTE,
} from "@/lib/sponte.functions";

// A aba fica atrás da permissão do módulo Financeiro em "Gerenciar Acessos":
// quem não vê o Financeiro não consulta nada aqui, mesmo chamando a server
// function diretamente.
export async function assertPermissaoAnaliseFinanceira(userId: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "can_view_module" as never,
    {
      _user_id: userId,
      _module: "financeiro",
    } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para usar as Análises com IA do Financeiro.");
}

type Escola = { id: string; name: string };

async function escolasPermitidas(userId: string): Promise<Escola[]> {
  const { data, error } = await supabaseAdmin.from("schools" as never).select("id, name");
  if (error) throw new Error(error.message);
  const todas = ((data ?? []) as unknown as Escola[]).slice();
  const allowed = await allowedSponteUnidades(userId);
  const permitidas = allowed === null ? todas : todas.filter((e) => allowed.includes(e.name));
  return permitidas.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function unidadesPermitidas(userId: string): Promise<string[]> {
  return (await escolasPermitidas(userId)).map((e) => e.name);
}

type Categoria = { id: string; name: string };
type Subcategoria = { id: string; name: string };

function combina(valor: string, filtro?: string): boolean {
  if (!filtro) return true;
  return valor.toLowerCase().includes(filtro.trim().toLowerCase());
}

type LinhaForecast = {
  school_id: string;
  month: string;
  description: string | null;
  cost_center_id: string | null;
  sub_cost_center_id: string | null;
  projected_amount: number | string | null;
  status: string | null;
  series_id: string | null;
};

type LinhaSerie = {
  school_id: string;
  description: string | null;
  cost_center_id: string | null;
  sub_cost_center_id: string | null;
  projected_amount: number | string | null;
  start_month: string;
  end_month: string | null;
  skipped_months: string[] | null;
};

type LinhaTransacao = {
  school_id: string;
  date: string;
  amount: number | string | null;
  cost_center_id: string | null;
  sub_cost_center_id: string | null;
};

type LinhaTransacaoSaida = LinhaTransacao & { description: string | null };

function statusDespesa(status: string | null): StatusDespesa {
  return status === "paid" || status === "scheduled" ? status : "pending";
}

export function criarFonteDados(userId: string): FonteDadosFinanceiros & FonteDadosModulos {
  // Caches por requisição: os catálogos são pequenos e usados por quase toda
  // ferramenta, e uma pergunta pode disparar várias consultas.
  let escolas: Escola[] | null = null;
  let categorias: Map<string, string> | null = null;
  let subcategorias: Map<string, string> | null = null;

  async function idsDe(
    unidades: string[],
  ): Promise<{ ids: string[]; nomePorId: Map<string, string> }> {
    escolas ??= await escolasPermitidas(userId);
    const alvo = escolas.filter((e) => unidades.includes(e.name));
    return {
      ids: alvo.map((e) => e.id),
      nomePorId: new Map(alvo.map((e) => [e.id, e.name])),
    };
  }

  async function catalogos() {
    if (!categorias || !subcategorias) {
      const [cc, sub] = await Promise.all([
        supabaseAdmin.from("cost_centers" as never).select("id, name"),
        supabaseAdmin.from("sub_cost_centers" as never).select("id, name"),
      ]);
      categorias = new Map(
        ((cc.data ?? []) as unknown as Categoria[]).map((c) => [c.id, c.name ?? ""]),
      );
      subcategorias = new Map(
        ((sub.data ?? []) as unknown as Subcategoria[]).map((s) => [s.id, s.name ?? ""]),
      );
    }
    return { categorias, subcategorias };
  }

  async function despesasFluxo(filtro: FiltroPeriodo): Promise<DespesaFluxo[]> {
    const { ids, nomePorId } = await idsDe(filtro.unidades);
    if (ids.length === 0) return [];
    const { categorias: cats, subcategorias: subs } = await catalogos();
    // `month` é o primeiro dia da competência; a janela é ampliada ao início do
    // mês da data inicial para não perder o mês parcialmente coberto.
    const data = await selectAll<LinhaForecast>(() =>
      supabaseAdmin
        .from("recurring_forecasts" as never)
        .select(
          "school_id, month, description, cost_center_id, sub_cost_center_id, projected_amount, status, series_id",
        )
        .in("school_id", ids)
        .gte("month", `${competencia(filtro.dataInicio)}-01`)
        .lte("month", filtro.dataFim)
        .order("id", { ascending: true }),
    );

    return data
      .map((r) => ({
        unidade: nomePorId.get(r.school_id) ?? "",
        mes: String(r.month).slice(0, 10),
        descricao: r.description ?? "",
        categoria: (r.cost_center_id && cats.get(r.cost_center_id)) || "",
        subcategoria: (r.sub_cost_center_id && subs.get(r.sub_cost_center_id)) || "",
        valor: Number(r.projected_amount ?? 0),
        status: statusDespesa(r.status),
        recorrente: Boolean(r.series_id),
      }))
      .filter(
        (d) =>
          d.unidade !== "" &&
          combina(d.categoria, filtro.categoria) &&
          combina(d.subcategoria, filtro.subcategoria),
      );
  }

  // Saídas realmente importadas do extrato bancário — a mesma tabela que a baixa
  // automática do Fluxo Futuro consome. A descrição É lida aqui (é o
  // beneficiário/fornecedor da saída); entradas ficam de fora justamente porque
  // o histórico delas carrega o nome do pagador.
  async function lancamentosExtrato(filtro: FiltroPeriodo): Promise<LancamentoExtrato[]> {
    const { ids, nomePorId } = await idsDe(filtro.unidades);
    if (ids.length === 0) return [];
    const { categorias: cats, subcategorias: subs } = await catalogos();
    const data = await selectAll<LinhaTransacaoSaida>(() =>
      supabaseAdmin
        .from("transactions" as never)
        .select("school_id, date, amount, description, cost_center_id, sub_cost_center_id")
        .eq("type", "saida")
        .in("school_id", ids)
        .gte("date", filtro.dataInicio)
        .lte("date", filtro.dataFim)
        .order("id", { ascending: true }),
    );

    return data
      .map((r) => ({
        unidade: nomePorId.get(r.school_id) ?? "",
        data: String(r.date).slice(0, 10),
        descricao: (r.description ?? "").trim(),
        categoria: (r.cost_center_id && cats.get(r.cost_center_id)) || "",
        subcategoria: (r.sub_cost_center_id && subs.get(r.sub_cost_center_id)) || "",
        valor: Math.abs(Number(r.amount ?? 0)),
      }))
      .filter(
        (l) =>
          l.unidade !== "" &&
          l.descricao !== "" &&
          combina(l.categoria, filtro.categoria) &&
          combina(l.subcategoria, filtro.subcategoria),
      );
  }

  async function seriesRecorrentes(filtro: { unidades: string[] }): Promise<SerieRecorrente[]> {
    const { ids, nomePorId } = await idsDe(filtro.unidades);
    if (ids.length === 0) return [];
    const { categorias: cats, subcategorias: subs } = await catalogos();
    const data = await selectAll<LinhaSerie>(() =>
      supabaseAdmin
        .from("recurring_series" as never)
        .select(
          "school_id, description, cost_center_id, sub_cost_center_id, projected_amount, start_month, end_month, skipped_months",
        )
        .in("school_id", ids)
        .order("id", { ascending: true }),
    );

    return data
      .map((r) => ({
        unidade: nomePorId.get(r.school_id) ?? "",
        descricao: r.description ?? "",
        categoria: (r.cost_center_id && cats.get(r.cost_center_id)) || "",
        subcategoria: (r.sub_cost_center_id && subs.get(r.sub_cost_center_id)) || "",
        valor: Number(r.projected_amount ?? 0),
        mesInicio: String(r.start_month).slice(0, 10),
        mesFim: r.end_month ? String(r.end_month).slice(0, 10) : null,
        mesesPulados: (r.skipped_months ?? []).map((m) => String(m).slice(0, 10)),
      }))
      .filter((s) => s.unidade !== "");
  }

  // Receitas realizadas: entradas do extrato bancário. A DESCRIÇÃO da transação
  // não é lida — o histórico do banco costuma trazer o nome do pagador, que está
  // fora do escopo desta análise.
  async function receitasRealizadas(filtro: FiltroPeriodo): Promise<ReceitaRealizada[]> {
    const { ids, nomePorId } = await idsDe(filtro.unidades);
    if (ids.length === 0) return [];
    const { categorias: cats, subcategorias: subs } = await catalogos();
    const data = await selectAll<LinhaTransacao>(() =>
      supabaseAdmin
        .from("transactions" as never)
        .select("school_id, date, amount, cost_center_id, sub_cost_center_id")
        .eq("type", "entrada")
        .in("school_id", ids)
        .gte("date", filtro.dataInicio)
        .lte("date", filtro.dataFim)
        .order("id", { ascending: true }),
    );

    return data
      .map((r) => ({
        unidade: nomePorId.get(r.school_id) ?? "",
        data: String(r.date).slice(0, 10),
        categoria: (r.cost_center_id && cats.get(r.cost_center_id)) || "",
        subcategoria: (r.sub_cost_center_id && subs.get(r.sub_cost_center_id)) || "",
        valor: Number(r.amount ?? 0),
      }))
      .filter(
        (r) =>
          r.unidade !== "" &&
          combina(r.categoria, filtro.categoria) &&
          combina(r.subcategoria, filtro.subcategoria),
      );
  }

  // Receitas previstas: as mesmas parcelas em aberto do Sponte que alimentam o
  // Fluxo Futuro, mas agregadas por unidade/mês aqui mesmo — as pendências
  // individuais (com nome de aluno e responsável) nunca saem desta função.
  async function receitasPrevistas(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<ReceitaPrevista[]> {
    const unidades = filtro.unidades.filter((u) => UNIDADES_SPONTE.includes(u));
    if (unidades.length === 0) return [];
    const agregado = new Map<string, ReceitaPrevista>();
    for (const unidade of unidades) {
      const coleta = await coletarInadimplenciaPorEscopo(
        unidade,
        filtro.dataInicio,
        filtro.dataFim,
        userId,
      );
      for (const p of coleta.pendencias) {
        const mes = `${competencia(p.vencimento ?? filtro.dataInicio)}-01`;
        const chave = `${unidade}|${mes}`;
        const atual = agregado.get(chave) ?? {
          unidade,
          mes,
          quantidadeBoletos: 0,
          valor: 0,
        };
        atual.quantidadeBoletos += 1;
        atual.valor += p.valorComDesconto;
        agregado.set(chave, atual);
      }
    }
    return [...agregado.values()];
  }

  async function inadimplencia(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<InadimplenciaAgregada[]> {
    const unidades = filtro.unidades.filter((u) => UNIDADES_SPONTE.includes(u));
    const linhas: InadimplenciaAgregada[] = [];
    for (const unidade of unidades) {
      const coleta = await coletarInadimplenciaPorEscopo(
        unidade,
        filtro.dataInicio,
        filtro.dataFim,
        userId,
      );
      // Só contagens e somas atravessam esta fronteira.
      linhas.push({
        unidade,
        quantidadeBoletos: coleta.pendencias.length,
        quantidadeParcelas: coleta.pendencias.reduce((s, p) => s + p.qtdParcelas, 0),
        valorTotal: coleta.pendencias.reduce((s, p) => s + p.valorComDesconto, 0),
        valorAcordo: coleta.pendencias.reduce((s, p) => s + p.valorAcordo, 0),
      });
    }
    return linhas;
  }

  return {
    despesasFluxo,
    lancamentosExtrato,
    receitasRealizadas,
    receitasPrevistas,
    seriesRecorrentes,
    inadimplencia,
    // Ferramentas dos módulos operacionais: mesma lista fechada, mesmo escopo de
    // unidades (o `idsDe` daqui já aplica o RBAC).
    ...criarFonteDadosModulos(idsDe),
  };
}

// ─── Auditoria ───────────────────────────────────────────────────────────────
//
// Registra a pergunta e as ferramentas disparadas. NÃO registra chave de API,
// token, nem os resultados financeiros detalhados: o log serve para auditar quem
// perguntou o quê e qual consulta fechada rodou.
export type RegistroAuditoria = {
  userId: string;
  pergunta: string;
  ferramentas: string[];
  // Argumentos já validados pelos schemas (nunca a string crua do modelo).
  argumentos: unknown[];
  sucesso: boolean;
  erro?: string;
  modelo?: string;
  tokensEntrada?: number;
  tokensSaida?: number;
};

export async function registrarAnalise(registro: RegistroAuditoria): Promise<void> {
  const { error } = await supabaseAdmin.from("ai_financeiro_analises" as never).insert({
    user_id: registro.userId,
    pergunta: registro.pergunta.slice(0, 2000),
    ferramentas: registro.ferramentas,
    argumentos: registro.argumentos,
    sucesso: registro.sucesso,
    erro: registro.erro?.slice(0, 500) ?? null,
    modelo: registro.modelo ?? "",
    tokens_entrada: registro.tokensEntrada ?? 0,
    tokens_saida: registro.tokensSaida ?? 0,
  } as never);
  // A auditoria não pode derrubar a resposta, mas a falha precisa aparecer no
  // log do servidor.
  if (error) console.error("[analises-ia] falha ao registrar auditoria:", error.message);
}
