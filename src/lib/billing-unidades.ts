// Regras puras de QUAIS unidades a automação de WhatsApp atende e sob quais
// condições, por número da Cloud API.
//
// A escola opera dois números (ver whatsapp-numeros): um atende CEC e CEC Baby,
// outro atende Núcleo Belvedere e Núcleo Vale do Sereno. Cada número tem a sua
// própria data de entrada em operação, e a régua de COBRANÇA (avisos de parcela
// vencida) não pode olhar para trás dela: cobrar retroativamente por um canal
// que ainda não estava no ar geraria uma avalanche de avisos de meses em que o
// responsável nunca foi avisado por ali.
//
//   • CEC / CEC Baby      — cobra vencimentos a partir de 01/08/2026, qualquer
//                           categoria de parcela (regra já em produção).
//   • Belvedere / Vale do Sereno
//                         — cobra vencimentos a partir de 01/09/2026 e somente
//                           parcelas de MENSALIDADE.
//
// A régua PREVENTIVA (lembrete de vencimento) não tem esse corte: ela só fala de
// parcela a vencer, então nada nela é retroativo.

import { UNIDADES_POR_GRUPO, grupoDaUnidade, type NumeroGrupo } from "./whatsapp-numeros";

export interface RegraCobrancaGrupo {
  // Vencimento mínimo (YYYY-MM-DD) elegível à régua de cobrança.
  dataBase: string;
  // Restringe a cobrança às parcelas de mensalidade.
  somenteMensalidade: boolean;
}

export const REGRAS_COBRANCA: Record<NumeroGrupo, RegraCobrancaGrupo> = {
  cec: { dataBase: "2026-08-01", somenteMensalidade: false },
  belvedere: { dataBase: "2026-09-01", somenteMensalidade: true },
};

// Grupos com ENVIO REAL liberado. A simulação (dry-run) avalia qualquer grupo
// configurado; o envio de verdade só acontece para os grupos desta lista, para a
// entrada de um número novo em operação ser uma decisão explícita e revisável.
export const GRUPOS_ENVIO_LIBERADO: readonly NumeroGrupo[] = ["cec", "belvedere"];

export function envioLiberado(grupo: NumeroGrupo): boolean {
  return GRUPOS_ENVIO_LIBERADO.includes(grupo);
}

export function regraCobrancaDaUnidade(
  unidade: string | null | undefined,
): RegraCobrancaGrupo | null {
  const grupo = grupoDaUnidade(unidade);
  return grupo ? REGRAS_COBRANCA[grupo] : null;
}

// Unidades atendidas pela automação, dados os grupos com número configurado e
// liberado. Unidade fora dessa lista não entra em nenhuma das duas réguas.
export function unidadesAtendidas(grupos: readonly NumeroGrupo[]): Set<string> {
  const unidades = new Set<string>();
  for (const grupo of grupos) for (const u of UNIDADES_POR_GRUPO[grupo]) unidades.add(u);
  return unidades;
}

export function unidadeAtendida(
  unidade: string | null | undefined,
  grupos: readonly NumeroGrupo[],
): boolean {
  return unidadesAtendidas(grupos).has((unidade ?? "").trim());
}

// Parcela de mensalidade: a categoria do Sponte vem por composição do boleto
// ("Mensalidade", "Material", "Almoço", "Acordo"...). Um boleto que reúne
// mensalidade e outros itens conta como mensalidade — é a parcela do mês.
export function ehMensalidade(categorias: readonly string[] | null | undefined): boolean {
  return (categorias ?? []).some((c) =>
    c
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .includes("mensalidade"),
  );
}

// Item elegível à régua de cobrança da sua unidade (vencimento a partir da data
// base do número e, onde a regra exige, apenas mensalidade). Sem categoria
// conhecida a parcela é descartada nas unidades com restrição: cobrar sem saber
// o que é a parcela é justamente o que a regra evita.
export interface ItemCobravel {
  unidade: string;
  vencimento: string;
  categorias?: string[];
}

export function cobrancaPermitida(item: ItemCobravel): boolean {
  const regra = regraCobrancaDaUnidade(item.unidade);
  if (!regra) return false;
  if (item.vencimento < regra.dataBase) return false;
  if (regra.somenteMensalidade && !ehMensalidade(item.categorias)) return false;
  return true;
}

export function filtrarPorRegraDeCobranca<T extends ItemCobravel>(itens: readonly T[]): T[] {
  return itens.filter((i) => cobrancaPermitida(i));
}

// Vencimento mais antigo que ainda interessa a algum dos grupos em operação.
// Serve para o cron não nem consultar o Sponte por dias que nenhuma unidade
// pode cobrar; a decisão final continua sendo por unidade.
export function menorDataBaseCobranca(grupos: readonly NumeroGrupo[]): string {
  const bases = grupos.map((g) => REGRAS_COBRANCA[g].dataBase).sort();
  return bases[0] ?? "9999-12-31";
}
