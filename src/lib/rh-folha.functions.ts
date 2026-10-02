// RH > Pagamentos > Salário: Folha de Pagamento importada do "Extrato Mensal".
// O PDF é lido no navegador; aqui chegam só os dados estruturados. Toda função
// checa rh.pagamentos.salario (Visualizar para ler, Editar para gravar, admin
// para reabrir competência) e a unidade do seletor global. Nada de nomes, CPFs
// ou valores da folha vai para log.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import {
  CALCULO_ACEITO,
  conferirIntegridade,
  paraCentavos,
  somenteDigitos,
  type ColaboradorExtrato,
} from "@/lib/extrato-mensal";
import {
  casarPorCpf,
  chaveColaborador,
  divergenciasDoColaborador,
  exigirCompetenciaAberta,
  inssDoMes,
  pendentesParaFechar,
  planejarReimportacao,
  totaisAjustados,
  type ColaboradorComparavel,
  type Divergencia,
  type OrigemRubrica,
  type RubricaFolha,
  type StatusColaboradorFolha,
  type StatusCompetencia,
} from "@/lib/folha-pagamento";
import { exigirPermissaoPagina } from "@/lib/permissoes-servidor";
import { competenciaValida } from "@/lib/rh-salario";
import { selectAll } from "@/lib/supabase-paginate";

// ---------- Tipos devolvidos ao cliente ----------

export type ImportacaoFolha = {
  id: string;
  competencia: string;
  status: StatusCompetencia;
  empresa: string;
  cnpj: string;
  calculo: string;
  cnpjColegio: string;
  cnpjDivergente: boolean;
  totalProventos: number;
  totalDescontos: number;
  liquidoGeral: number;
  totalColaboradores: number;
  importadoEm: string;
  importadoPorNome: string;
  reimportadoEm: string | null;
  reimportadoPorNome: string | null;
  fechadoEm: string | null;
  fechadoPorNome: string | null;
  reabertoEm: string | null;
  reabertoPorNome: string | null;
};

export type RubricaGravada = RubricaFolha & { ordem: number; valorHora: string };

export type ColaboradorFolhaGravado = Omit<ColaboradorComparavel, "rubricas"> & {
  id: string;
  tipo: "empregado" | "contribuinte";
  vinculo: string;
  admissao: string;
  cargo: string;
  cbo: string;
  horasMes: string;
  salarioBase: number;
  informativa: number;
  informativaDedutora: number;
  baseInss: number;
  excedenteInss: number;
  baseFgts: number;
  valorFgts: number;
  baseIrrf: number;
  observacoes: string[];
  funcionarioId: string | null;
  vinculoManual: boolean;
  proventosPdf: number;
  descontosPdf: number;
  liquidoPdf: number;
  status: StatusColaboradorFolha;
  divergencias: Divergencia[];
  confirmadoEm: string | null;
  confirmadoPorNome: string | null;
  ajustadoEm: string | null;
  ajustadoPorNome: string | null;
  ajusteObservacao: string | null;
  rubricas: RubricaGravada[];
  restituicaoGravada: number | null;
};

/** Colaborador gravado como estava no PDF (sem ajustes), para a reimportação. */
export type ColaboradorOriginal = ColaboradorComparavel & { ajustadoManualmente: boolean };

export type MarcacaoRestituicao = {
  funcionarioId: string;
  recebe: boolean;
  atualizadoEm: string;
  atualizadoPorNome: string;
};

// ---------- Linhas do banco ----------

type Num = number | string;

type ImportacaoRow = {
  id: string;
  school_id: string;
  competencia: string;
  status: StatusCompetencia;
  empresa: string;
  cnpj: string;
  calculo: string;
  cnpj_colegio: string;
  cnpj_divergente: boolean;
  total_proventos: Num;
  total_descontos: Num;
  liquido_geral: Num;
  total_colaboradores: number;
  importado_em: string;
  importado_por_nome: string;
  reimportado_em: string | null;
  reimportado_por_nome: string | null;
  fechado_em: string | null;
  fechado_por_nome: string | null;
  reaberto_em: string | null;
  reaberto_por_nome: string | null;
};

type ColaboradorRow = {
  id: string;
  importacao_id: string;
  funcionario_id: string | null;
  vinculo_manual: boolean;
  tipo: "empregado" | "contribuinte";
  codigo: string;
  nome: string;
  cpf: string;
  situacao: string;
  vinculo: string;
  admissao: string;
  cargo: string;
  cbo: string;
  horas_mes: string;
  salario_base: Num;
  informativa: Num;
  informativa_dedutora: Num;
  base_inss: Num;
  excedente_inss: Num;
  base_fgts: Num;
  valor_fgts: Num;
  base_irrf: Num;
  observacoes: string[] | null;
  proventos_pdf: Num;
  descontos_pdf: Num;
  liquido_pdf: Num;
  proventos: Num;
  descontos: Num;
  liquido: Num;
  status: StatusColaboradorFolha;
  divergencias: Divergencia[] | null;
  confirmado_em: string | null;
  confirmado_por_nome: string | null;
  ajustado_em: string | null;
  ajustado_por_nome: string | null;
  ajuste_observacao: string | null;
};

type RubricaRow = {
  colaborador_id: string;
  ordem: number;
  tipo: "P" | "D";
  codigo: string;
  descricao: string;
  referencia: string;
  valor_hora: string;
  valor: Num;
  valor_original: Num | null;
  origem: OrigemRubrica;
  removida: boolean;
};

type FuncionarioRow = {
  id: string;
  nome_completo: string;
  cpf: string | null;
  data_rescisao: string | null;
};

const IMPORTACAO_COLS =
  "id, school_id, competencia, status, empresa, cnpj, calculo, cnpj_colegio, cnpj_divergente, total_proventos, total_descontos, liquido_geral, total_colaboradores, importado_em, importado_por_nome, reimportado_em, reimportado_por_nome, fechado_em, fechado_por_nome, reaberto_em, reaberto_por_nome";

const COLABORADOR_COLS =
  "id, importacao_id, funcionario_id, vinculo_manual, tipo, codigo, nome, cpf, situacao, vinculo, admissao, cargo, cbo, horas_mes, salario_base, informativa, informativa_dedutora, base_inss, excedente_inss, base_fgts, valor_fgts, base_irrf, observacoes, proventos_pdf, descontos_pdf, liquido_pdf, proventos, descontos, liquido, status, divergencias, confirmado_em, confirmado_por_nome, ajustado_em, ajustado_por_nome, ajuste_observacao";

const n = (v: Num | null | undefined): number => (v == null ? 0 : Number(v));

function paraImportacao(r: ImportacaoRow): ImportacaoFolha {
  return {
    id: r.id,
    competencia: r.competencia,
    status: r.status,
    empresa: r.empresa,
    cnpj: r.cnpj,
    calculo: r.calculo,
    cnpjColegio: r.cnpj_colegio,
    cnpjDivergente: r.cnpj_divergente,
    totalProventos: n(r.total_proventos),
    totalDescontos: n(r.total_descontos),
    liquidoGeral: n(r.liquido_geral),
    totalColaboradores: r.total_colaboradores,
    importadoEm: r.importado_em,
    importadoPorNome: r.importado_por_nome,
    reimportadoEm: r.reimportado_em,
    reimportadoPorNome: r.reimportado_por_nome,
    fechadoEm: r.fechado_em,
    fechadoPorNome: r.fechado_por_nome,
    reabertoEm: r.reaberto_em,
    reabertoPorNome: r.reaberto_por_nome,
  };
}

function paraRubrica(r: RubricaRow): RubricaGravada {
  return {
    ordem: r.ordem,
    tipo: r.tipo,
    codigo: r.codigo,
    descricao: r.descricao,
    referencia: r.referencia,
    valorHora: r.valor_hora,
    valor: n(r.valor),
    valorOriginal: r.valor_original == null ? null : n(r.valor_original),
    origem: r.origem,
    removida: r.removida,
  };
}

function paraColaborador(
  r: ColaboradorRow,
  rubricas: RubricaGravada[],
  restituicaoGravada: number | null,
): ColaboradorFolhaGravado {
  return {
    id: r.id,
    tipo: r.tipo,
    codigo: r.codigo,
    nome: r.nome,
    cpf: r.cpf,
    situacao: r.situacao,
    vinculo: r.vinculo,
    admissao: r.admissao,
    cargo: r.cargo,
    cbo: r.cbo,
    horasMes: r.horas_mes,
    salarioBase: n(r.salario_base),
    informativa: n(r.informativa),
    informativaDedutora: n(r.informativa_dedutora),
    baseInss: n(r.base_inss),
    excedenteInss: n(r.excedente_inss),
    baseFgts: n(r.base_fgts),
    valorFgts: n(r.valor_fgts),
    baseIrrf: n(r.base_irrf),
    observacoes: r.observacoes ?? [],
    funcionarioId: r.funcionario_id,
    vinculoManual: r.vinculo_manual,
    proventosPdf: n(r.proventos_pdf),
    descontosPdf: n(r.descontos_pdf),
    liquidoPdf: n(r.liquido_pdf),
    proventos: n(r.proventos),
    descontos: n(r.descontos),
    liquido: n(r.liquido),
    status: r.status,
    divergencias: r.divergencias ?? [],
    confirmadoEm: r.confirmado_em,
    confirmadoPorNome: r.confirmado_por_nome,
    ajustadoEm: r.ajustado_em,
    ajustadoPorNome: r.ajustado_por_nome,
    ajusteObservacao: r.ajuste_observacao,
    rubricas,
    restituicaoGravada,
  };
}

// ---------- Acesso ----------

const CHAVE = ["rh.pagamentos.salario"] as const;

async function exigirFolha(userId: string, edicao: boolean): Promise<void> {
  await exigirPermissaoPagina(
    userId,
    CHAVE,
    edicao ? "editar" : "ver",
    edicao
      ? "Você não tem permissão para editar a folha de pagamento."
      : "Você não tem permissão para ver a folha de pagamento.",
  );
}

async function ehAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_roles" as never)
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { role: string }[]).some((r) => r.role === "admin");
}

/** Unidade específica do seletor global e liberada para o usuário. Devolve o nome. */
export async function exigirUnidadeFolha(userId: string, schoolId: string): Promise<string> {
  if (!(await ehAdmin(userId))) {
    const { data, error } = await supabaseAdmin
      .from("user_schools" as never)
      .select("school_id")
      .eq("user_id", userId)
      .eq("school_id", schoolId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Você não tem acesso a esta unidade.");
  }
  const { data, error } = await supabaseAdmin
    .from("schools" as never)
    .select("name")
    .eq("id", schoolId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unidade não encontrada.");
  return (data as { name: string }).name;
}

async function contexto(userId: string, schoolId: string, edicao: boolean) {
  await exigirFolha(userId, edicao);
  return exigirUnidadeFolha(userId, schoolId);
}

// ---------- Leitura ----------

async function importacaoDa(schoolId: string, competencia: string): Promise<ImportacaoRow | null> {
  const { data, error } = await supabaseAdmin
    .from("rh_folha_importacoes" as never)
    .select(IMPORTACAO_COLS)
    .eq("school_id", schoolId)
    .eq("competencia", competencia)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ImportacaoRow | null) ?? null;
}

async function exigirImportacaoAberta(
  schoolId: string,
  competencia: string,
): Promise<ImportacaoRow> {
  const imp = await importacaoDa(schoolId, competencia);
  if (!imp) throw new Error("Não há folha importada nesta competência.");
  exigirCompetenciaAberta(imp.status);
  return imp;
}

async function colaboradoresDa(importacaoId: string): Promise<ColaboradorFolhaGravado[]> {
  const cols = await selectAll<ColaboradorRow>(() =>
    supabaseAdmin
      .from("rh_folha_colaboradores" as never)
      .select(COLABORADOR_COLS)
      .eq("importacao_id", importacaoId)
      .order("id"),
  );
  if (!cols.length) return [];
  const rubs = await selectAll<RubricaRow>(() =>
    supabaseAdmin
      .from("rh_folha_rubricas" as never)
      .select(
        "colaborador_id, ordem, tipo, codigo, descricao, referencia, valor_hora, valor, valor_original, origem, removida, rh_folha_colaboradores!inner(importacao_id)",
      )
      .eq("rh_folha_colaboradores.importacao_id", importacaoId)
      .order("colaborador_id")
      .order("ordem"),
  );
  const rest = await selectAll<{ colaborador_id: string; valor_restituicao: Num }>(() =>
    supabaseAdmin
      .from("rh_folha_restituicoes" as never)
      .select("colaborador_id, valor_restituicao")
      .eq("importacao_id", importacaoId)
      .order("colaborador_id"),
  );
  const porCol = new Map<string, RubricaGravada[]>();
  for (const r of rubs) {
    const lista = porCol.get(r.colaborador_id) ?? [];
    lista.push(paraRubrica(r));
    porCol.set(r.colaborador_id, lista);
  }
  const restMap = new Map(rest.map((r) => [r.colaborador_id, n(r.valor_restituicao)]));
  return cols
    .map((c) =>
      paraColaborador(
        c,
        (porCol.get(c.id) ?? []).sort((a, b) => a.ordem - b.ordem),
        restMap.get(c.id) ?? null,
      ),
    )
    .sort((a, b) => Number(a.codigo) - Number(b.codigo) || a.codigo.localeCompare(b.codigo));
}

/** Retrato do PDF gravado (antes de qualquer ajuste manual). */
function original(c: ColaboradorFolhaGravado): ColaboradorOriginal {
  return {
    codigo: c.codigo,
    nome: c.nome,
    cpf: c.cpf,
    situacao: c.situacao,
    proventos: c.proventosPdf,
    descontos: c.descontosPdf,
    liquido: c.liquidoPdf,
    rubricas: c.rubricas
      .filter((r) => r.origem === "pdf")
      .map((r) => ({
        tipo: r.tipo,
        codigo: r.codigo,
        descricao: r.descricao,
        valor: r.valorOriginal ?? r.valor,
      })),
    ajustadoManualmente: c.ajustadoEm != null,
  };
}

/** Folha vigente (com ajustes), usada na comparação com o mês seguinte. */
function vigente(c: ColaboradorFolhaGravado): ColaboradorComparavel {
  return {
    codigo: c.codigo,
    nome: c.nome,
    cpf: c.cpf,
    situacao: c.situacao,
    proventos: c.proventos,
    descontos: c.descontos,
    liquido: c.liquido,
    rubricas: c.rubricas.filter((r) => !r.removida),
  };
}

async function folhaAnterior(
  schoolId: string,
  competencia: string,
): Promise<{ competencia: string; colaboradores: ColaboradorComparavel[] } | null> {
  const { data, error } = await supabaseAdmin
    .from("rh_folha_importacoes" as never)
    .select("id, competencia")
    .eq("school_id", schoolId)
    .lt("competencia", competencia)
    .order("competencia", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const imp = data as { id: string; competencia: string };
  return {
    competencia: imp.competencia,
    colaboradores: (await colaboradoresDa(imp.id)).map(vigente),
  };
}

async function funcionariosDa(schoolId: string): Promise<FuncionarioRow[]> {
  return selectAll<FuncionarioRow>(() =>
    supabaseAdmin
      .from("funcionarios" as never)
      .select("id, nome_completo, cpf, data_rescisao")
      .eq("school_id", schoolId)
      .order("id"),
  );
}

async function cnpjDoColegio(unidade: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("documentos_colegios" as never)
    .select("cnpj")
    .eq("unidade", unidade)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return ((data as { cnpj: string | null } | null)?.cnpj ?? "").trim();
}

async function registrarEvento(
  importacaoId: string,
  colaboradorId: string | null,
  tipo: string,
  dados: Record<string, unknown>,
  userId: string,
  nome: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("rh_folha_eventos" as never).insert({
    importacao_id: importacaoId,
    colaborador_id: colaboradorId,
    tipo,
    dados,
    por: userId,
    por_nome: nome,
  } as never);
  if (error) throw new Error(error.message);
}

/** Confirmado e vinculado ao RH: bruto = proventos e líquido em funcionarios_salarios. */
async function sincronizarSalarios(
  competencia: string,
  colaboradores: readonly { funcionarioId: string | null; proventos: number; liquido: number }[],
  userId: string,
  nome: string,
): Promise<void> {
  const linhas = colaboradores
    .filter((c) => c.funcionarioId)
    .map((c) => ({
      funcionario_id: c.funcionarioId,
      competencia,
      valor: c.proventos,
      valor_liquido: c.liquido,
      observacao: "Extrato Mensal (folha confirmada)",
      created_by: userId,
      created_by_nome: nome,
      updated_at: new Date().toISOString(),
    }));
  if (!linhas.length) return;
  const { error } = await supabaseAdmin
    .from("funcionarios_salarios" as never)
    .upsert(linhas as never, { onConflict: "funcionario_id,competencia" } as never);
  if (error) throw new Error(error.message);
}

// ---------- Validação da folha recebida ----------

const numero = z.number().finite();
const texto = (max: number) => z.string().max(max);

const rubricaSchema = z.object({
  tipo: z.enum(["P", "D"]),
  codigo: texto(20),
  descricao: texto(200),
  referencia: texto(50),
  valorHora: texto(50),
  valor: numero,
});

const colaboradorSchema = z.object({
  tipo: z.enum(["empregado", "contribuinte"]),
  codigo: z.string().trim().min(1).max(20),
  nome: z.string().trim().min(1).max(200),
  cpf: texto(20),
  situacao: texto(100),
  vinculo: texto(100),
  admissao: texto(20),
  cargoCodigo: texto(20),
  cargo: texto(300),
  cbo: texto(20),
  horasMes: texto(20),
  salarioBase: numero,
  rubricas: z.array(rubricaSchema).max(200),
  proventos: numero,
  descontos: numero,
  informativa: numero,
  informativaDedutora: numero,
  liquido: numero,
  baseInss: numero,
  excedenteInss: numero,
  baseFgts: numero,
  valorFgts: numero,
  baseIrrf: numero,
  observacoes: z.array(texto(500)).max(50),
  pagina: z.number().int(),
});

const folhaSchema = z.object({
  empresa: texto(300),
  cnpj: texto(30),
  calculo: texto(100),
  competencia: z.string(),
  totalProventos: numero,
  totalDescontos: numero,
  liquidoGeral: numero,
  colaboradores: z.array(colaboradorSchema).min(1).max(2000),
});

type FolhaRecebida = z.infer<typeof folhaSchema>;

function revalidarFolha(folha: FolhaRecebida): void {
  if (folha.calculo.trim() !== CALCULO_ACEITO) {
    throw new Error(`Só é aceito "Cálculo: ${CALCULO_ACEITO}" (veio "${folha.calculo}").`);
  }
  if (!competenciaValida(folha.competencia)) throw new Error("Competência inválida (AAAA-MM).");
  const codigos = new Set<string>();
  for (const c of folha.colaboradores) {
    if (codigos.has(c.codigo)) throw new Error(`Código ${c.codigo} repetido na folha.`);
    codigos.add(c.codigo);
  }
  const erros = conferirIntegridade(
    folha as { colaboradores: ColaboradorExtrato[] } & FolhaRecebida,
  );
  if (erros.length) throw new Error(`A folha não fecha; nada foi importado.\n${erros.join("\n")}`);
}

const cnpjsIguais = (a: string, b: string) => somenteDigitos(a) === somenteDigitos(b);

// ---------- Server functions: leitura ----------

const schoolInput = z.object({ schoolId: z.string().uuid() });
const compInput = schoolInput.extend({ competencia: z.string() });

export const listarCompetenciasFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schoolInput.parse(input))
  .handler(async ({ data, context }): Promise<ImportacaoFolha[]> => {
    await contexto(context.userId, data.schoolId, false);
    const rows = await selectAll<ImportacaoRow>(() =>
      supabaseAdmin
        .from("rh_folha_importacoes" as never)
        .select(IMPORTACAO_COLS)
        .eq("school_id", data.schoolId)
        .order("competencia", { ascending: false }),
    );
    return rows.map(paraImportacao);
  });

export const obterFolhaCompetencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => compInput.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      importacao: ImportacaoFolha | null;
      colaboradores: ColaboradorFolhaGravado[];
    }> => {
      await contexto(context.userId, data.schoolId, false);
      if (!competenciaValida(data.competencia)) throw new Error("Competência inválida (AAAA-MM).");
      const imp = await importacaoDa(data.schoolId, data.competencia);
      if (!imp) return { importacao: null, colaboradores: [] };
      return { importacao: paraImportacao(imp), colaboradores: await colaboradoresDa(imp.id) };
    },
  );

/** Tudo que a tela precisa para conferir o PDF antes de gravar. */
export const prepararImportacaoFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => compInput.extend({ cnpj: texto(30) }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      cnpjColegio: string;
      cnpjDivergente: boolean;
      anterior: { competencia: string; colaboradores: ColaboradorComparavel[] } | null;
      gravada: { status: StatusCompetencia; colaboradores: ColaboradorOriginal[] } | null;
    }> => {
      const unidade = await contexto(context.userId, data.schoolId, true);
      if (!competenciaValida(data.competencia)) throw new Error("Competência inválida (AAAA-MM).");
      const cnpjColegio = await cnpjDoColegio(unidade);
      const imp = await importacaoDa(data.schoolId, data.competencia);
      const gravada = imp
        ? { status: imp.status, colaboradores: (await colaboradoresDa(imp.id)).map(original) }
        : null;
      return {
        cnpjColegio,
        cnpjDivergente: !cnpjsIguais(cnpjColegio, data.cnpj),
        anterior: await folhaAnterior(data.schoolId, data.competencia),
        gravada,
      };
    },
  );

// ---------- Importação / reimportação ----------

export const gravarImportacaoFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    schoolInput
      .extend({
        folha: folhaSchema,
        selecionados: z.array(z.string().max(20)).max(2000),
        confirmarCnpj: z.boolean(),
      })
      .parse(input),
  )
  .handler(
    async ({ data, context }): Promise<{ gravados: number; iguais: number; retirados: number }> => {
      const unidade = await contexto(context.userId, data.schoolId, true);
      const folha = data.folha;
      revalidarFolha(folha);
      const cnpjColegio = await cnpjDoColegio(unidade);
      const cnpjDivergente = !cnpjsIguais(cnpjColegio, folha.cnpj);
      if (cnpjDivergente && !data.confirmarCnpj) {
        throw new Error(
          `CNPJ do PDF (${folha.cnpj || "vazio"}) diferente do CNPJ cadastrado de ${unidade} (${cnpjColegio || "não cadastrado"}). Confirme para continuar.`,
        );
      }

      const imp = await importacaoDa(data.schoolId, folha.competencia);
      if (imp) exigirCompetenciaAberta(imp.status);
      const gravados = imp ? await colaboradoresDa(imp.id) : [];
      const gravadoPorChave = new Map(gravados.map((g) => [chaveColaborador(g), g]));
      const plano = planejarReimportacao(gravados.map(original), folha.colaboradores);

      const anterior = await folhaAnterior(data.schoolId, folha.competencia);
      const anteriorPorChave = new Map(
        (anterior?.colaboradores ?? []).map((c) => [chaveColaborador(c), c]),
      );
      const funcionarios = await funcionariosDa(data.schoolId);
      const selecionados = new Set(data.selecionados);

      const aGravar = [...plano.novos, ...plano.substituidos.map((s) => s.colaborador)];
      const retirar = new Set(plano.retirados.map((r) => r.codigo));
      for (const c of plano.substituidos.map((s) => s.colaborador)) {
        const g = gravadoPorChave.get(chaveColaborador(c));
        if (g && g.codigo !== c.codigo) retirar.add(g.codigo);
      }

      const gravar = aGravar.map((c) => {
        const g = gravadoPorChave.get(chaveColaborador(c));
        const manual = g?.vinculoManual ? g.funcionarioId : null;
        const funcionarioId = manual ?? casarPorCpf(funcionarios, c.cpf)?.id ?? null;
        return {
          funcionario_id: funcionarioId,
          vinculo_manual: !!manual,
          tipo: c.tipo,
          codigo: c.codigo,
          nome: c.nome,
          cpf: somenteDigitos(c.cpf),
          situacao: c.situacao,
          vinculo: c.vinculo,
          admissao: c.admissao,
          cargo_codigo: c.cargoCodigo,
          cargo: c.cargo,
          cbo: c.cbo,
          horas_mes: c.horasMes,
          salario_base: c.salarioBase,
          informativa: c.informativa,
          informativa_dedutora: c.informativaDedutora,
          base_inss: c.baseInss,
          excedente_inss: c.excedenteInss,
          base_fgts: c.baseFgts,
          valor_fgts: c.valorFgts,
          base_irrf: c.baseIrrf,
          observacoes: c.observacoes,
          proventos: c.proventos,
          descontos: c.descontos,
          liquido: c.liquido,
          status: selecionados.has(c.codigo) ? "confirmado" : "em_conferencia",
          divergencias: anterior
            ? divergenciasDoColaborador(anteriorPorChave.get(chaveColaborador(c)) ?? null, c)
            : [],
          rubricas: c.rubricas.map((r) => ({
            tipo: r.tipo,
            codigo: r.codigo,
            descricao: r.descricao,
            referencia: r.referencia,
            valor_hora: r.valorHora,
            valor: r.valor,
          })),
        };
      });

      const nome = await nomeDoUsuario(context.userId);
      const { error } = await supabaseAdmin.rpc(
        "rh_folha_gravar_importacao" as never,
        {
          p: {
            school_id: data.schoolId,
            competencia: folha.competencia,
            empresa: folha.empresa,
            cnpj: folha.cnpj,
            cnpj_colegio: cnpjColegio,
            cnpj_divergente: cnpjDivergente,
            total_proventos: folha.totalProventos,
            total_descontos: folha.totalDescontos,
            liquido_geral: folha.liquidoGeral,
            total_colaboradores: folha.colaboradores.length,
            por: context.userId,
            por_nome: nome,
            gravar,
            retirar: [...retirar],
          },
        } as never,
      );
      if (error) throw new Error(error.message);

      await sincronizarSalarios(
        folha.competencia,
        gravar
          .filter((g) => g.status === "confirmado")
          .map((g) => ({
            funcionarioId: g.funcionario_id,
            proventos: g.proventos,
            liquido: g.liquido,
          })),
        context.userId,
        nome,
      );
      return { gravados: gravar.length, iguais: plano.iguais.length, retirados: retirar.size };
    },
  );

// ---------- Conferência ----------

async function colaboradoresDaImportacao(
  importacaoId: string,
  ids: readonly string[],
): Promise<ColaboradorFolhaGravado[]> {
  const todos = await colaboradoresDa(importacaoId);
  const alvo = new Set(ids);
  const achados = todos.filter((c) => alvo.has(c.id));
  if (achados.length !== alvo.size) throw new Error("Colaborador não pertence a esta folha.");
  return achados;
}

export const confirmarColaboradoresFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    compInput.extend({ ids: z.array(z.string().uuid()).min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ confirmados: number }> => {
    await contexto(context.userId, data.schoolId, true);
    const imp = await exigirImportacaoAberta(data.schoolId, data.competencia);
    const alvo = (await colaboradoresDaImportacao(imp.id, data.ids)).filter(
      (c) => c.status === "em_conferencia",
    );
    if (!alvo.length) return { confirmados: 0 };
    const nome = await nomeDoUsuario(context.userId);
    const { error } = await supabaseAdmin
      .from("rh_folha_colaboradores" as never)
      .update({
        status: "confirmado",
        confirmado_em: new Date().toISOString(),
        confirmado_por: context.userId,
        confirmado_por_nome: nome,
        atualizado_em: new Date().toISOString(),
      } as never)
      .in(
        "id",
        alvo.map((c) => c.id),
      )
      .eq("status", "em_conferencia");
    if (error) throw new Error(error.message);
    for (const c of alvo)
      await registrarEvento(imp.id, c.id, "confirmacao", {}, context.userId, nome);
    await sincronizarSalarios(data.competencia, alvo, context.userId, nome);
    return { confirmados: alvo.length };
  });

export const reabrirConferenciaFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => compInput.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await contexto(context.userId, data.schoolId, true);
    const imp = await exigirImportacaoAberta(data.schoolId, data.competencia);
    const [c] = await colaboradoresDaImportacao(imp.id, [data.id]);
    if (c.status !== "confirmado") return { ok: true };
    const nome = await nomeDoUsuario(context.userId);
    const { error } = await supabaseAdmin
      .from("rh_folha_colaboradores" as never)
      .update({
        status: "em_conferencia",
        confirmado_em: null,
        confirmado_por: null,
        confirmado_por_nome: null,
        atualizado_em: new Date().toISOString(),
      } as never)
      .eq("id", c.id);
    if (error) throw new Error(error.message);
    await registrarEvento(
      imp.id,
      c.id,
      "reabertura_conferencia",
      { confirmado_em: c.confirmadoEm, confirmado_por_nome: c.confirmadoPorNome },
      context.userId,
      nome,
    );
    return { ok: true };
  });

/**
 * Ajuste manual: as rubricas do PDF chegam só com valor/removida (descrição e
 * valor original vêm do banco); as manuais chegam inteiras. Totais recalculados aqui.
 */
export const ajustarColaboradorFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    compInput
      .extend({
        id: z.string().uuid(),
        observacao: z.string().trim().min(1, "A observação do ajuste é obrigatória.").max(1000),
        pdf: z
          .array(
            z.object({
              ordem: z.number().int(),
              valor: numero.nonnegative(),
              removida: z.boolean(),
            }),
          )
          .max(200),
        manuais: z
          .array(
            z.object({
              tipo: z.enum(["P", "D"]),
              codigo: texto(20),
              descricao: z.string().trim().min(1).max(200),
              valor: numero.nonnegative(),
            }),
          )
          .max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await contexto(context.userId, data.schoolId, true);
    const imp = await exigirImportacaoAberta(data.schoolId, data.competencia);
    const [c] = await colaboradoresDaImportacao(imp.id, [data.id]);
    if (c.status !== "em_conferencia") {
      throw new Error("Colaborador confirmado: reabra a conferência para ajustar.");
    }
    const edicao = new Map(data.pdf.map((p) => [p.ordem, p]));
    const rubricas: RubricaGravada[] = [
      ...c.rubricas
        .filter((r) => r.origem === "pdf")
        .map((r) => {
          const e = edicao.get(r.ordem);
          return e ? { ...r, valor: Math.round(e.valor * 100) / 100, removida: e.removida } : r;
        }),
      ...data.manuais.map((m, i) => ({
        ordem: 10000 + i,
        tipo: m.tipo,
        codigo: m.codigo.trim(),
        descricao: m.descricao,
        referencia: "",
        valorHora: "",
        valor: Math.round(m.valor * 100) / 100,
        valorOriginal: null,
        origem: "manual" as const,
        removida: false,
      })),
    ];
    const t = totaisAjustados(rubricas);
    const { error } = await supabaseAdmin.rpc(
      "rh_folha_ajustar_colaborador" as never,
      {
        p: {
          colaborador_id: c.id,
          observacao: data.observacao,
          por: context.userId,
          por_nome: await nomeDoUsuario(context.userId),
          proventos: t.proventos,
          descontos: t.descontos,
          liquido: t.liquido,
          rubricas: rubricas.map((r) => ({
            tipo: r.tipo,
            codigo: r.codigo,
            descricao: r.descricao,
            referencia: r.referencia,
            valor_hora: r.valorHora,
            valor: r.valor,
            valor_original: r.valorOriginal,
            origem: r.origem,
            removida: r.removida,
          })),
        },
      } as never,
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const vincularFuncionarioFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    compInput
      .extend({ id: z.string().uuid(), funcionarioId: z.string().uuid().nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await contexto(context.userId, data.schoolId, true);
    const imp = await exigirImportacaoAberta(data.schoolId, data.competencia);
    const todos = await colaboradoresDa(imp.id);
    const c = todos.find((x) => x.id === data.id);
    if (!c) throw new Error("Colaborador não pertence a esta folha.");
    if (data.funcionarioId) {
      const funcionarios = await funcionariosDa(data.schoolId);
      if (!funcionarios.some((f) => f.id === data.funcionarioId)) {
        throw new Error("Funcionário não pertence a esta unidade.");
      }
      if (todos.some((x) => x.id !== c.id && x.funcionarioId === data.funcionarioId)) {
        throw new Error("Este funcionário já está vinculado a outro colaborador da folha.");
      }
    }
    const nome = await nomeDoUsuario(context.userId);
    const { error } = await supabaseAdmin
      .from("rh_folha_colaboradores" as never)
      .update({
        funcionario_id: data.funcionarioId,
        vinculo_manual: data.funcionarioId != null,
        atualizado_em: new Date().toISOString(),
      } as never)
      .eq("id", c.id);
    if (error) throw new Error(error.message);
    await registrarEvento(
      imp.id,
      c.id,
      "vinculo",
      { antes: c.funcionarioId, depois: data.funcionarioId },
      context.userId,
      nome,
    );
    if (c.status === "confirmado" && data.funcionarioId) {
      await sincronizarSalarios(
        data.competencia,
        [{ funcionarioId: data.funcionarioId, proventos: c.proventos, liquido: c.liquido }],
        context.userId,
        nome,
      );
    }
    return { ok: true };
  });

// ---------- Fechamento ----------

async function marcacoesDa(schoolId: string): Promise<MarcacaoRestituicao[]> {
  const rows = await selectAll<{
    funcionario_id: string;
    recebe: boolean;
    atualizado_em: string;
    atualizado_por_nome: string;
  }>(() =>
    supabaseAdmin
      .from("rh_restituicao_inss_marcacoes" as never)
      .select(
        "funcionario_id, recebe, atualizado_em, atualizado_por_nome, funcionarios!inner(school_id)",
      )
      .eq("funcionarios.school_id", schoolId)
      .order("funcionario_id"),
  );
  return rows.map((r) => ({
    funcionarioId: r.funcionario_id,
    recebe: r.recebe,
    atualizadoEm: r.atualizado_em,
    atualizadoPorNome: r.atualizado_por_nome,
  }));
}

export const fecharCompetenciaFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => compInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await contexto(context.userId, data.schoolId, true);
    const imp = await exigirImportacaoAberta(data.schoolId, data.competencia);
    const colaboradores = await colaboradoresDa(imp.id);
    const pendentes = pendentesParaFechar(colaboradores);
    if (pendentes.length) {
      throw new Error(
        `Ainda há ${pendentes.length} colaborador(es) Em conferência: ${pendentes.join(", ")}.`,
      );
    }
    const marcados = new Set(
      (await marcacoesDa(data.schoolId)).filter((m) => m.recebe).map((m) => m.funcionarioId),
    );
    const nome = await nomeDoUsuario(context.userId);
    const agora = new Date().toISOString();
    const restituicoes = colaboradores.map((c) => {
      const inss = inssDoMes(c.rubricas);
      const marcado = c.funcionarioId != null && marcados.has(c.funcionarioId);
      return {
        importacao_id: imp.id,
        colaborador_id: c.id,
        funcionario_id: c.funcionarioId,
        marcado,
        valor_inss: inss,
        valor_restituicao: marcado ? inss : 0,
        gravado_em: agora,
        gravado_por: context.userId,
        gravado_por_nome: nome,
      };
    });
    if (restituicoes.length) {
      const { error } = await supabaseAdmin
        .from("rh_folha_restituicoes" as never)
        .upsert(restituicoes as never, { onConflict: "colaborador_id" } as never);
      if (error) throw new Error(error.message);
    }
    const { error } = await supabaseAdmin
      .from("rh_folha_importacoes" as never)
      .update({
        status: "fechada",
        fechado_em: agora,
        fechado_por: context.userId,
        fechado_por_nome: nome,
      } as never)
      .eq("id", imp.id)
      .eq("status", "aberta");
    if (error) throw new Error(error.message);
    await registrarEvento(imp.id, null, "fechamento", {}, context.userId, nome);
    return { ok: true };
  });

export const reabrirCompetenciaFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => compInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await contexto(context.userId, data.schoolId, true);
    if (!(await ehAdmin(context.userId))) {
      throw new Error("Apenas administradores podem reabrir a competência.");
    }
    const imp = await importacaoDa(data.schoolId, data.competencia);
    if (!imp) throw new Error("Não há folha importada nesta competência.");
    if (imp.status !== "fechada") return { ok: true };
    const nome = await nomeDoUsuario(context.userId);
    const { error } = await supabaseAdmin
      .from("rh_folha_importacoes" as never)
      .update({
        status: "aberta",
        reaberto_em: new Date().toISOString(),
        reaberto_por: context.userId,
        reaberto_por_nome: nome,
      } as never)
      .eq("id", imp.id);
    if (error) throw new Error(error.message);
    await registrarEvento(
      imp.id,
      null,
      "reabertura",
      { fechado_em: imp.fechado_em, fechado_por_nome: imp.fechado_por_nome },
      context.userId,
      nome,
    );
    return { ok: true };
  });

// ---------- Restituição do INSS (marcação por funcionário) ----------

export const listarMarcacoesRestituicao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schoolInput.parse(input))
  .handler(async ({ data, context }): Promise<MarcacaoRestituicao[]> => {
    await contexto(context.userId, data.schoolId, false);
    return marcacoesDa(data.schoolId);
  });

export const marcarRestituicaoInss = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    schoolInput.extend({ funcionarioId: z.string().uuid(), recebe: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await contexto(context.userId, data.schoolId, true);
    const funcionarios = await funcionariosDa(data.schoolId);
    if (!funcionarios.some((f) => f.id === data.funcionarioId)) {
      throw new Error("Funcionário não pertence a esta unidade.");
    }
    const nome = await nomeDoUsuario(context.userId);
    const agora = new Date().toISOString();
    const { error } = await supabaseAdmin.from("rh_restituicao_inss_marcacoes" as never).upsert(
      {
        funcionario_id: data.funcionarioId,
        recebe: data.recebe,
        atualizado_em: agora,
        atualizado_por: context.userId,
        atualizado_por_nome: nome,
      } as never,
      { onConflict: "funcionario_id" } as never,
    );
    if (error) throw new Error(error.message);
    const { error: hErr } = await supabaseAdmin
      .from("rh_restituicao_inss_historico" as never)
      .insert({
        funcionario_id: data.funcionarioId,
        recebe: data.recebe,
        em: agora,
        por: context.userId,
        por_nome: nome,
      } as never);
    if (hErr) throw new Error(hErr.message);
    return { ok: true };
  });

// ---------- Lote de Folhas Salvas ----------

/**
 * Com folha importada na competência, o lote só aceita Confirmados (pelo
 * líquido) e funcionários fora da folha (Manuais). Usado por salvarFolhaSalario.
 */
export async function conferirLoteComFolha(
  schoolId: string,
  competencia: string,
  itens: readonly { employee_id: string; total_amount: number }[],
): Promise<void> {
  const funcionarios = new Set((await funcionariosDa(schoolId)).map((f) => f.id));
  if (itens.some((i) => !funcionarios.has(i.employee_id))) {
    throw new Error("Há funcionário de outra unidade no lote.");
  }
  const imp = await importacaoDa(schoolId, competencia);
  if (!imp) return;
  const porFuncionario = new Map(
    (await colaboradoresDa(imp.id)).filter((c) => c.funcionarioId).map((c) => [c.funcionarioId, c]),
  );
  for (const i of itens) {
    const c = porFuncionario.get(i.employee_id);
    if (!c) continue;
    if (c.status !== "confirmado") {
      throw new Error(`${c.nome} está Em conferência e não pode entrar no lote.`);
    }
    if (paraCentavos(c.liquido) !== paraCentavos(i.total_amount)) {
      throw new Error(`O valor de ${c.nome} no lote difere do líquido confirmado na folha.`);
    }
  }
}

/** Funcionário já na folha importada da competência: o salário vem do Extrato Mensal. */
export async function exigirSalarioForaDaFolha(
  funcionarioId: string,
  competencia: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("rh_folha_colaboradores" as never)
    .select("id, rh_folha_importacoes!inner(competencia)")
    .eq("funcionario_id", funcionarioId)
    .eq("rh_folha_importacoes.competencia", competencia)
    .limit(1);
  if (error) throw new Error(error.message);
  if ((data ?? []).length) {
    throw new Error(
      "Este funcionário está na folha importada desta competência; o valor vem do Extrato Mensal.",
    );
  }
}

async function unidadeDoFuncionario(funcionarioId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("funcionarios" as never)
    .select("school_id")
    .eq("id", funcionarioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const schoolId = (data as { school_id: string | null } | null)?.school_id;
  if (!schoolId) throw new Error("Funcionário não encontrado.");
  return schoolId;
}

/** Salário manual: unidade do funcionário liberada e fora da folha importada. */
export async function exigirSalarioManual(
  userId: string,
  funcionarioId: string,
  competencia: string | null,
): Promise<void> {
  await exigirUnidadeFolha(userId, await unidadeDoFuncionario(funcionarioId));
  if (competencia) await exigirSalarioForaDaFolha(funcionarioId, competencia);
}
