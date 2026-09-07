// Seção "Extras" da Rematrícula (lógica pura).
//
// (a) Extras lançados no Sponte para o ANO LETIVO da rematrícula: parcelas do
//     contas a receber com vencimento naquele ano (é o único vínculo de ano
//     que o GetParcelas expõe — a parcela não traz plano nem ano letivo), não
//     canceladas, nas categorias recorrentes de extras. Uma categoria conta uma
//     vez; o valor mensal é o da parcela de vencimento mais cedo no ano.
// (b) O que o responsável deixou marcado ao finalizar.
// (c) O plano do Diário do Aluno do mesmo ano (refeições contratadas + Horário
//     Estendido → Hora Extra), quando existir.
//
// A comparação só sinaliza: nada é alterado no Sponte nem no Diário.

import type { MealPlan, SchedulePlan } from "@/lib/diario";
import type { SegmentoSerie } from "@/lib/matricula-form";
import {
  CATEGORIA_HORA_EXTRA,
  CATEGORIA_POR_REFEICAO,
  normalizarCategoria,
  temHorarioEstendido,
} from "@/lib/diario-auditoria";

/** Categorias recorrentes de extras, na ordem em que aparecem no formulário. */
export const CATEGORIAS_EXTRAS_REMATRICULA = [
  "Lanche da Manhã",
  "Almoço",
  "Lanche da Tarde",
  "Jantar",
  "Hora Extra",
] as const;

export type CategoriaExtra = (typeof CATEGORIAS_EXTRAS_REMATRICULA)[number];

export interface TituloParaExtras {
  categoria: string;
  /** YYYY-MM-DD */
  vencimento: string;
  valor: number;
  situacao: string;
}

export interface ExtraSponte {
  categoria: CategoriaExtra;
  valorMensal: number;
  parcelas: number;
}

export type TipoDivergenciaExtra = "inconsistente" | "remocao_pendente" | "lancamento_pendente";

export interface DivergenciaExtra {
  categoria: CategoriaExtra;
  tipo: TipoDivergenciaExtra;
  /** Valor mensal envolvido; null quando o extra é novo e ainda não tem preço lançado. */
  valor: number | null;
  mensagem: string;
}

export const ROTULO_TIPO_DIVERGENCIA: Record<TipoDivergenciaExtra, string> = {
  inconsistente: "Inconsistente",
  remocao_pendente: "Remoção pendente",
  lancamento_pendente: "Lançamento pendente",
};

export function categoriaExtraRematricula(texto: string): CategoriaExtra | null {
  const chave = normalizarCategoria(texto);
  return CATEGORIAS_EXTRAS_REMATRICULA.find((c) => normalizarCategoria(c) === chave) ?? null;
}

function cancelada(situacao: string): boolean {
  return /cancel|inativ|estorn/i.test(situacao);
}

function centavos(valor: number): number {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100);
}

/** Extras lançados no Sponte com vencimento no ano letivo informado. */
export function extrasDoSponteNoAno(
  titulos: readonly TituloParaExtras[],
  anoLetivo: number,
): ExtraSponte[] {
  const porCategoria = new Map<CategoriaExtra, TituloParaExtras[]>();
  for (const t of titulos) {
    const cat = categoriaExtraRematricula(t.categoria);
    if (!cat || cancelada(t.situacao) || centavos(t.valor) <= 0) continue;
    if (!t.vencimento.startsWith(`${anoLetivo}-`)) continue;
    const lista = porCategoria.get(cat) ?? [];
    lista.push(t);
    porCategoria.set(cat, lista);
  }
  const saida: ExtraSponte[] = [];
  for (const cat of CATEGORIAS_EXTRAS_REMATRICULA) {
    const lista = porCategoria.get(cat);
    if (!lista?.length) continue;
    const primeira = [...lista].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
    saida.push({
      categoria: cat,
      valorMensal: centavos(primeira.valor) / 100,
      parcelas: lista.length,
    });
  }
  return saida;
}

/** Categorias de extra implicadas pelo plano do Diário (refeições + Horário Estendido). */
export function categoriasDoDiario(entrada: {
  plan: MealPlan;
  schedule: SchedulePlan;
  segmento: SegmentoSerie;
}): Set<CategoriaExtra> {
  const saida = new Set<CategoriaExtra>();
  for (const [meal, categoria] of Object.entries(CATEGORIA_POR_REFEICAO) as [
    keyof MealPlan,
    string,
  ][]) {
    if (entrada.plan[meal].length === 0) continue;
    const cat = categoriaExtraRematricula(categoria);
    if (cat) saida.add(cat);
  }
  if (temHorarioEstendido(entrada.schedule, entrada.segmento)) {
    const cat = categoriaExtraRematricula(CATEGORIA_HORA_EXTRA);
    if (cat) saida.add(cat);
  }
  return saida;
}

export function formatarValorMensal(valor: number | null): string {
  if (valor === null) return "valor mensal a definir";
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mês`;
}

/**
 * Cada categoria gera no máximo uma divergência, nesta precedência:
 *  - estava no Sponte e o responsável desmarcou → remoção pendente;
 *  - não estava no Sponte e o responsável marcou → lançamento pendente;
 *  - Sponte e responsável concordam, mas o Diário do ano não tem a categoria
 *    → inconsistente (só quando existe plano do Diário para o ano).
 * Categorias que só o Diário tem já são cobertas pela Auditoria Plano × Sponte.
 */
export function divergenciasExtras(entrada: {
  aluno: string;
  sponte: readonly ExtraSponte[];
  selecionadas: readonly CategoriaExtra[];
  diario: ReadonlySet<CategoriaExtra> | null;
}): DivergenciaExtra[] {
  const noSponte = new Map(entrada.sponte.map((e) => [e.categoria, e]));
  const marcadas = new Set(entrada.selecionadas);
  const saida: DivergenciaExtra[] = [];

  for (const categoria of CATEGORIAS_EXTRAS_REMATRICULA) {
    const lancado = noSponte.get(categoria);
    const marcada = marcadas.has(categoria);

    if (lancado && !marcada) {
      saida.push({
        categoria,
        tipo: "remocao_pendente",
        valor: lancado.valorMensal,
        mensagem: `Responsável removeu ${categoria} (${formatarValorMensal(lancado.valorMensal)}) de ${entrada.aluno}: é necessário cancelar manualmente no Sponte e no Diário do Aluno.`,
      });
      continue;
    }
    if (!lancado && marcada) {
      saida.push({
        categoria,
        tipo: "lancamento_pendente",
        valor: null,
        mensagem: `Novo extra contratado por ${entrada.aluno}: ${categoria} (${formatarValorMensal(null)}). É necessário lançar manualmente no Sponte e configurar no Diário do Aluno.`,
      });
      continue;
    }
    if (lancado && marcada && entrada.diario && !entrada.diario.has(categoria)) {
      saida.push({
        categoria,
        tipo: "inconsistente",
        valor: lancado.valorMensal,
        mensagem: `${categoria} (${formatarValorMensal(lancado.valorMensal)}) está lançado no Sponte para ${entrada.aluno}, mas não consta no plano do Diário do Aluno: divergência de lançamento a revisar manualmente.`,
      });
    }
  }
  return saida;
}

/** Valida e normaliza a seleção vinda do formulário (ignora repetidas/desconhecidas). */
export function normalizarSelecaoExtras(itens: readonly string[]): CategoriaExtra[] {
  const marcadas = new Set<CategoriaExtra>();
  for (const item of itens) {
    const cat = categoriaExtraRematricula(item);
    if (cat) marcadas.add(cat);
  }
  return CATEGORIAS_EXTRAS_REMATRICULA.filter((c) => marcadas.has(c));
}
