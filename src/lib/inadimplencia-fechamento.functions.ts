// Fechamento mensal MANUAL da inadimplência por unidade — server functions.
// Recalcula sempre no servidor (nunca confia em valores da tela) com as MESMAS
// fontes do card "Inadimplência Anual": coletarInadimplenciaPorEscopo (Sponte,
// desconto de Acordo) e faturamentoRecebido sobre o extrato (exclusões de
// resgate de fundo / aporte de outra unidade, ids resolvidos aqui no servidor).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { selectAll } from "@/lib/supabase-paginate";
import { coletarInadimplenciaPorEscopo } from "@/lib/sponte.functions";
import { resolverIdsFinanceiros, type IdsFinanceiros } from "@/lib/dashboard-financeiro";
import { faturamentoRecebido, type ReceitaExtrato } from "@/lib/inadimplencia-faturamento";
import { hojeEmBrasilia } from "@/lib/alunos-ativos";
import {
  anoMesValido,
  arredondarReais,
  faturamentoAcumulado,
  inadimplenteLiquido,
  janelaAcumulada,
  janelaMes,
  mesesPendentes,
  percentualInadimplencia,
  podeFecharMes,
  type FechamentoRow,
  type MesPendente,
} from "@/lib/inadimplencia-fechamento";

const UNIDADES_SPONTE = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

type SchoolRow = { id: string; name: string; faturamento_retroativo_jan_mai: number | null };

async function isAdmin(userId: string): Promise<boolean> {
  const { data: roles } = await supabaseAdmin
    .from("user_roles" as never)
    .select("role")
    .eq("user_id", userId);
  return ((roles ?? []) as { role: string }[]).some((r) => r.role === "admin");
}

async function assertAdmin(userId: string) {
  if (!(await isAdmin(userId)))
    throw new Error("Apenas administradores podem fechar a inadimplência.");
}

// Unidades que o usuário pode ver (null = todas, admin). Espelha alunos-ativos.functions.
async function allowedSchoolIds(userId: string): Promise<string[] | null> {
  if (await isAdmin(userId)) return null;
  const { data: us } = await supabaseAdmin
    .from("user_schools" as never)
    .select("school_id")
    .eq("user_id", userId);
  return ((us ?? []) as { school_id: string }[]).map((r) => r.school_id);
}

async function schoolPorNome(unidade: string): Promise<SchoolRow> {
  const { data, error } = await supabaseAdmin
    .from("schools" as never)
    .select("id, name, faturamento_retroativo_jan_mai")
    .eq("name", unidade)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Unidade "${unidade}" não encontrada.`);
  return data as SchoolRow;
}

async function schoolsSponte(): Promise<SchoolRow[]> {
  const { data, error } = await supabaseAdmin
    .from("schools" as never)
    .select("id, name, faturamento_retroativo_jan_mai")
    .in("name", UNIDADES_SPONTE)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as SchoolRow[];
}

// Mesmos ids do hook useCatalogosFinanceiros, resolvidos no servidor.
async function idsFinanceirosServidor(): Promise<IdsFinanceiros> {
  type Nomeado = { id: string; name: string };
  const [rc, cc] = await Promise.all([
    supabaseAdmin.from("revenue_categories" as never).select("id, name"),
    supabaseAdmin.from("cost_centers" as never).select("id, name"),
  ]);
  if (rc.error) throw new Error(rc.error.message);
  if (cc.error) throw new Error(cc.error.message);
  return resolverIdsFinanceiros((rc.data ?? []) as Nomeado[], (cc.data ?? []) as Nomeado[]);
}

// Receitas do extrato: entrada, sem transação-pai, da unidade, no intervalo.
async function receitasExtrato(
  schoolId: string,
  inicioYMD: string,
  fimYMD: string,
): Promise<ReceitaExtrato[]> {
  if (inicioYMD > fimYMD) return [];
  return selectAll<ReceitaExtrato>(() =>
    supabaseAdmin
      .from("transactions" as never)
      .select("amount, description, revenue_category_id")
      .eq("type", "entrada")
      .is("parent_transaction_id", null)
      .eq("school_id", schoolId)
      .gte("date", inicioYMD)
      .lte("date", fimYMD)
      .order("id", { ascending: true }),
  );
}

export interface FechamentoCalculado {
  unidade: string;
  schoolId: string;
  anoMes: string;
  inadimplenteMes: number;
  faturamentoMes: number;
  percentualMes: number | null;
  inadimplenteAcumulado: number;
  faturamentoAcumulado: number;
  percentualAcumulado: number | null;
  boletosMes: number;
  boletosAcumulado: number;
}

export interface SimulacaoFechamento {
  /** Preenchido só quando o cálculo está completo e o mês pode ser gravado. */
  calculo: FechamentoCalculado | null;
  /** Motivo da trava (parcial, erro, retroativo, calendário). */
  trava: string | null;
  existente: { fechado_por: string; fechado_por_nome: string; fechado_em: string } | null;
}

async function calcularFechamento(
  school: SchoolRow,
  anoMes: string,
  userId: string,
): Promise<{ calculo: FechamentoCalculado | null; trava: string | null }> {
  const cal = podeFecharMes(anoMes, hojeEmBrasilia());
  if (!cal.ok) return { calculo: null, trava: cal.motivo };
  if (!UNIDADES_SPONTE.includes(school.name))
    return { calculo: null, trava: "Unidade sem integração com o Sponte." };

  const acumulada = janelaAcumulada(anoMes);
  if (acumulada.semDados) return { calculo: null, trava: "Ano sem extrato bancário." };
  if (acumulada.usaRetroativo && school.faturamento_retroativo_jan_mai == null)
    return {
      calculo: null,
      trava: "Faturamento retroativo (Jan–Mai) não informado em Dados dos Colégios.",
    };

  const mes = janelaMes(anoMes);
  const [coletaMes, coletaAno, ids, receitasMes, receitasAno] = await Promise.all([
    coletarInadimplenciaPorEscopo(school.name, mes.inicioYMD, mes.fimYMD, userId),
    coletarInadimplenciaPorEscopo(school.name, acumulada.inicioYMD, acumulada.fimYMD, userId),
    idsFinanceirosServidor(),
    receitasExtrato(school.id, mes.inicioYMD, mes.fimYMD),
    receitasExtrato(school.id, acumulada.receitasDesdeYMD, acumulada.fimYMD),
  ]);

  for (const c of [coletaMes, coletaAno]) {
    if (c.indisponivel) return { calculo: null, trava: "Integração com o Sponte indisponível." };
    if (c.error) return { calculo: null, trava: `Erro do Sponte: ${c.error}` };
    if (c.parcialAte)
      return {
        calculo: null,
        trava: `Coleta parcial do Sponte (boletos varridos só até ${c.parcialAte.split("-").reverse().join("/")}). Tente novamente.`,
      };
  }

  const inadMes = inadimplenteLiquido(coletaMes.pendencias);
  const inadAno = inadimplenteLiquido(coletaAno.pendencias);
  const fatMes = arredondarReais(faturamentoRecebido(receitasMes, ids));
  const fatAno = faturamentoAcumulado(
    school.faturamento_retroativo_jan_mai,
    acumulada.usaRetroativo,
    receitasAno,
    ids,
  );

  return {
    trava: null,
    calculo: {
      unidade: school.name,
      schoolId: school.id,
      anoMes,
      inadimplenteMes: inadMes.total,
      faturamentoMes: fatMes,
      percentualMes: percentualInadimplencia(inadMes.total, fatMes),
      inadimplenteAcumulado: inadAno.total,
      faturamentoAcumulado: fatAno,
      percentualAcumulado: percentualInadimplencia(inadAno.total, fatAno),
      boletosMes: inadMes.boletos,
      boletosAcumulado: inadAno.boletos,
    },
  };
}

async function nomeUsuario(userId: string): Promise<string> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  return (
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    data?.user?.email ||
    userId
  );
}

async function fechamentoExistente(
  schoolId: string,
  anoMes: string,
): Promise<SimulacaoFechamento["existente"]> {
  const { data, error } = await supabaseAdmin
    .from("inadimplencia_fechamento_mensal" as never)
    .select("fechado_por, fechado_em")
    .eq("school_id", schoolId)
    .eq("ano_mes", anoMes)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as { fechado_por: string; fechado_em: string };
  return { ...row, fechado_por_nome: await nomeUsuario(row.fechado_por) };
}

const InputSimular = z.object({
  unidade: z.string().min(1),
  anoMes: z.string().refine(anoMesValido, "Mês inválido (YYYY-MM)."),
});

export const simularFechamentoInadimplencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSimular.parse(input))
  .handler(async ({ data, context }): Promise<SimulacaoFechamento> => {
    await assertAdmin(context.userId);
    const school = await schoolPorNome(data.unidade);
    const [{ calculo, trava }, existente] = await Promise.all([
      calcularFechamento(school, data.anoMes, context.userId),
      fechamentoExistente(school.id, data.anoMes),
    ]);
    return { calculo, trava, existente };
  });

const InputGravar = InputSimular.extend({ substituir: z.boolean().default(false) });

export const gravarFechamentoInadimplencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputGravar.parse(input))
  .handler(async ({ data, context }): Promise<FechamentoCalculado> => {
    await assertAdmin(context.userId);
    const school = await schoolPorNome(data.unidade);
    const existente = await fechamentoExistente(school.id, data.anoMes);
    if (existente && !data.substituir)
      throw new Error("Este mês já foi fechado. Use 'Substituir fechamento' para regravar.");

    const { calculo, trava } = await calcularFechamento(school, data.anoMes, context.userId);
    if (!calculo) throw new Error(trava ?? "Não foi possível calcular o fechamento.");

    const { error } = await supabaseAdmin.from("inadimplencia_fechamento_mensal" as never).upsert(
      {
        school_id: school.id,
        ano_mes: data.anoMes,
        inadimplente_mes: calculo.inadimplenteMes,
        faturamento_mes: calculo.faturamentoMes,
        inadimplente_acumulado: calculo.inadimplenteAcumulado,
        faturamento_acumulado: calculo.faturamentoAcumulado,
        boletos_mes: calculo.boletosMes,
        boletos_acumulado: calculo.boletosAcumulado,
        fechado_por: context.userId,
        fechado_em: new Date().toISOString(),
      } as never,
      { onConflict: "school_id,ano_mes" },
    );
    if (error) throw new Error(error.message);
    return calculo;
  });

const InputHistorico = z.object({ schoolIds: z.array(z.string()).optional() }).optional();

export const fetchHistoricoInadimplencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputHistorico.parse(input))
  .handler(async ({ data, context }): Promise<FechamentoRow[]> => {
    const allowed = await allowedSchoolIds(context.userId);
    const pedidos = data?.schoolIds ?? null;
    // Interseção: só unidades pedidas E permitidas (admin: as pedidas, ou todas).
    const filtro =
      allowed === null ? pedidos : pedidos ? pedidos.filter((id) => allowed.includes(id)) : allowed;
    if (filtro !== null && filtro.length === 0) return [];
    const rows = await selectAll<FechamentoRow>(() => {
      let q = supabaseAdmin
        .from("inadimplencia_fechamento_mensal" as never)
        .select(
          "school_id, ano_mes, inadimplente_mes, faturamento_mes, inadimplente_acumulado, faturamento_acumulado, boletos_mes, boletos_acumulado, fechado_por, fechado_em",
        )
        .order("ano_mes")
        .order("school_id");
      if (filtro !== null) q = q.in("school_id", filtro);
      return q;
    });
    return rows.map((r) => ({
      ...r,
      inadimplente_mes: Number(r.inadimplente_mes),
      faturamento_mes: Number(r.faturamento_mes),
      inadimplente_acumulado: Number(r.inadimplente_acumulado),
      faturamento_acumulado: Number(r.faturamento_acumulado),
      boletos_mes: Number(r.boletos_mes),
      boletos_acumulado: Number(r.boletos_acumulado),
    }));
  });

export interface MesPendenteNomeado extends MesPendente {
  unidade: string;
}

export const mesesPendentesFechamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MesPendenteNomeado[]> => {
    await assertAdmin(context.userId);
    const schools = await schoolsSponte();
    const fechados = await selectAll<Pick<FechamentoRow, "school_id" | "ano_mes">>(() =>
      supabaseAdmin
        .from("inadimplencia_fechamento_mensal" as never)
        .select("school_id, ano_mes")
        .order("id"),
    );
    const nome = new Map(schools.map((s) => [s.id, s.name]));
    return mesesPendentes(
      fechados,
      schools.map((s) => s.id),
      hojeEmBrasilia(),
    ).map((p) => ({ ...p, unidade: nome.get(p.school_id) ?? p.school_id }));
  });
