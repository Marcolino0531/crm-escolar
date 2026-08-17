// Esportes Extracurriculares — regras de arrecadação, repasse e visibilidade.
//
// Modelo de negócio: cada aluno matriculado numa modalidade paga a mensalidade
// dela como uma CATEGORIA dentro do boleto normal do Sponte (do mesmo jeito que
// "Material Pedagógico"). O arrecadado do mês é a soma do que foi efetivamente
// PAGO nessa categoria; sobre ele incide o percentual contratual do parceiro, e
// o restante fica retido com o colégio.
//
// Aqui ficam apenas funções puras: a leitura do Sponte e do banco fica nas
// server functions. O dinheiro é sempre arredondado em centavos para o repasse
// e o retido fecharem exatamente com o arrecadado.

// Parcela do Sponte na visão desta regra (subconjunto de TituloSponteAluno).
export interface ParcelaSponte {
  vencimento: string; // YYYY-MM-DD
  categoria: string;
  valorPago: number;
  quitada: boolean;
  dataPagamento: string; // YYYY-MM-DD ("" quando em aberto)
}

// O que um aluno pagou na modalidade em um mês.
export interface PagamentoAlunoModalidade {
  alunoId: string;
  alunoNome: string;
  valorPago: number;
  // Data do último pagamento identificado no mês ("" quando nada foi pago).
  dataPagamento: string;
  // Frequência do aluno no cadastro e a mensalidade dela. "" / 0 quando a
  // modalidade não usa frequências ou o aluno ainda não tem uma escolhida.
  frequenciaNome: string;
  valorEsperado: number;
}

// Frequência oferecida pela modalidade, cada uma com sua mensalidade: Jazz
// 2x/semana R$ 230,00 e 1x/semana R$ 210,00. `vezesSemana` é o que liga os dias
// marcados na matrícula ao preço.
export interface FrequenciaModalidade {
  id: string;
  nome: string;
  valorMensal: number;
  vezesSemana: number | null;
}

// ---------- Dias da semana do aluno na modalidade ----------
// 1 = segunda … 7 = domingo (ISO), o mesmo índice do Diário do Aluno.

export const DIAS_SEMANA_CURTO: Record<number, string> = {
  1: "Seg",
  2: "Ter",
  3: "Qua",
  4: "Qui",
  5: "Sex",
  6: "Sáb",
  7: "Dom",
};

// Dia repetido não conta duas vezes: a frequência é quantos dias DISTINTOS o
// aluno assiste na semana.
export function normalizarDias(dias: readonly number[] | null | undefined): number[] {
  const validos = (dias ?? [])
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  return Array.from(new Set(validos)).sort((a, b) => a - b);
}

export function vezesPorSemana(dias: readonly number[] | null | undefined): number {
  return normalizarDias(dias).length;
}

export function rotuloDias(dias: readonly number[] | null | undefined): string {
  return normalizarDias(dias)
    .map((d) => DIAS_SEMANA_CURTO[d])
    .join(" · ");
}

// Frequência (e portanto o valor) derivada dos dias marcados: 2 dias procuram a
// frequência de 2x/semana. Sem dia marcado não há frequência derivada — o valor
// esperado do aluno fica indefinido em vez de virar um preço chutado.
export function frequenciaPorDias(
  frequencias: readonly FrequenciaModalidade[],
  dias: readonly number[] | null | undefined,
): FrequenciaModalidade | null {
  const vezes = vezesPorSemana(dias);
  if (vezes === 0) return null;
  return frequencias.find((f) => Number(f.vezesSemana) === vezes) ?? null;
}

export interface RepasseCalculado {
  valorArrecadado: number;
  percentualParceiro: number;
  valorRepasse: number;
  valorRetido: number;
}

// Modalidade na visão da regra de visibilidade.
export interface ModalidadeVisivel {
  id: string;
}

export function arredondarCentavos(valor: number): number {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

// Comparação de categoria tolerante ao que o Sponte devolve: acento, caixa e
// espaço duplo variam entre cadastros ("Jiu Jitsu" × "jiujitsu").
export function normalizarCategoria(categoria: string): string {
  return (categoria ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function mesmaCategoria(a: string, b: string): boolean {
  const na = normalizarCategoria(a);
  return na.length > 0 && na === normalizarCategoria(b);
}

// Parcelas da modalidade em um mês: a competência é o MÊS DO VENCIMENTO, então
// um pagamento atrasado continua pertencendo ao mês que ele quita.
export function parcelasDaModalidade(
  parcelas: ParcelaSponte[],
  categoriaSponte: string,
  mesReferencia: string,
): ParcelaSponte[] {
  return parcelas.filter(
    (p) =>
      mesmaCategoria(p.categoria, categoriaSponte) &&
      (p.vencimento ?? "").slice(0, 7) === mesReferencia,
  );
}

// Quanto o aluno efetivamente pagou na modalidade no mês. Só parcela quitada
// entra: parcela em aberto não é arrecadação e não pode gerar repasse.
export function pagamentoDoAluno(
  aluno: {
    alunoId: string;
    alunoNome: string;
    frequencia?: FrequenciaModalidade | null;
  },
  parcelas: ParcelaSponte[],
  categoriaSponte: string,
  mesReferencia: string,
): PagamentoAlunoModalidade {
  const doMes = parcelasDaModalidade(parcelas, categoriaSponte, mesReferencia).filter(
    (p) => p.quitada,
  );
  const valorPago = arredondarCentavos(doMes.reduce((s, p) => s + (Number(p.valorPago) || 0), 0));
  const datas = doMes.map((p) => p.dataPagamento).filter(Boolean);
  return {
    alunoId: aluno.alunoId,
    alunoNome: aluno.alunoNome,
    valorPago,
    dataPagamento: datas.length ? datas.sort()[datas.length - 1] : "",
    frequenciaNome: aluno.frequencia?.nome ?? "",
    valorEsperado: arredondarCentavos(Number(aluno.frequencia?.valorMensal) || 0),
  };
}

export function totalArrecadado(pagamentos: PagamentoAlunoModalidade[]): number {
  return arredondarCentavos(pagamentos.reduce((s, p) => s + (Number(p.valorPago) || 0), 0));
}

// Quanto a modalidade DEVERIA arrecadar no mês pela frequência de cada aluno.
// Não entra em nenhum cálculo de repasse: serve para comparar com o arrecadado e
// mostrar o que falta receber.
export function totalEsperado(pagamentos: PagamentoAlunoModalidade[]): number {
  return arredondarCentavos(pagamentos.reduce((s, p) => s + (Number(p.valorEsperado) || 0), 0));
}

// ---------- Relação de valores (parcelas reais do Sponte) ----------

// Situação da parcela como a secretaria fala. Derivada, nunca cadastrada: o
// Sponte só diz se a parcela foi baixada; "vencido" é baixa ausente + data
// passada.
export type SituacaoParcela = "quitado" | "vencido" | "a_vencer";

// Parcela do Sponte com o que a relação de valores mostra. O `valor` é o do
// boleto — inclusive quando é proporcional (meio mês) e diverge da mensalidade
// cheia da modalidade.
export interface ParcelaCategoriaSponte extends ParcelaSponte {
  valor: number;
  numeroParcela: string;
}

export interface ParcelaAlunoModalidade {
  alunoId: string;
  alunoNome: string;
  numeroParcela: string;
  vencimento: string; // YYYY-MM-DD
  mesReferencia: string; // YYYY-MM do vencimento
  valor: number;
  valorPago: number;
  situacao: SituacaoParcela;
  dataPagamento: string;
}

export function situacaoParcela(
  parcela: { quitada: boolean; vencimento: string },
  hoje: string,
): SituacaoParcela {
  if (parcela.quitada) return "quitado";
  if (parcela.vencimento && parcela.vencimento < hoje) return "vencido";
  return "a_vencer";
}

// Todas as parcelas do aluno na categoria da modalidade, em ordem de
// vencimento. O valor é o que o Sponte devolve: a proporcional do primeiro mês
// não é recalculada pela mensalidade da modalidade.
export function parcelasAlunoNaModalidade(
  aluno: { alunoId: string; alunoNome: string },
  parcelas: readonly ParcelaCategoriaSponte[],
  categoriaSponte: string,
  hoje: string,
): ParcelaAlunoModalidade[] {
  return parcelas
    .filter((p) => mesmaCategoria(p.categoria, categoriaSponte))
    .map((p) => ({
      alunoId: aluno.alunoId,
      alunoNome: aluno.alunoNome,
      numeroParcela: p.numeroParcela,
      vencimento: p.vencimento,
      mesReferencia: (p.vencimento ?? "").slice(0, 7),
      valor: arredondarCentavos(p.valor),
      valorPago: arredondarCentavos(p.valorPago),
      situacao: situacaoParcela(p, hoje),
      dataPagamento: p.dataPagamento,
    }))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

// Parcelas de um mês (YYYY-MM) pelo mês do VENCIMENTO: é o mês que a secretaria
// vê no boleto, mesmo que a baixa tenha caído em outro.
export function parcelasDoMes(
  parcelas: readonly ParcelaAlunoModalidade[],
  mesReferencia: string,
): ParcelaAlunoModalidade[] {
  return parcelas.filter((p) => p.mesReferencia === mesReferencia);
}

export interface ResumoParcelas {
  quitado: number;
  vencido: number;
  aVencer: number;
  total: number;
}

export function resumoParcelas(parcelas: readonly ParcelaAlunoModalidade[]): ResumoParcelas {
  const soma = (s: SituacaoParcela) =>
    arredondarCentavos(
      parcelas.filter((p) => p.situacao === s).reduce((acc, p) => acc + (Number(p.valor) || 0), 0),
    );
  const quitado = soma("quitado");
  const vencido = soma("vencido");
  const aVencer = soma("a_vencer");
  return { quitado, vencido, aVencer, total: arredondarCentavos(quitado + vencido + aVencer) };
}

// Repasse do parceiro e parte retida pelo colégio. O retido é a diferença (e não
// um segundo arredondamento), para que repasse + retido = arrecadado sempre.
export function calcularRepasse(
  valorArrecadado: number,
  percentualParceiro: number,
): RepasseCalculado {
  const arrecadado = arredondarCentavos(valorArrecadado);
  const percentual = Math.min(Math.max(Number(percentualParceiro) || 0, 0), 100);
  const repasse = arredondarCentavos((arrecadado * percentual) / 100);
  return {
    valorArrecadado: arrecadado,
    percentualParceiro: percentual,
    valorRepasse: repasse,
    valorRetido: arredondarCentavos(arrecadado - repasse),
  };
}

// ---------- Repasse com múltiplos parceiros ----------
// Duas formas de contrato, escolhidas por modalidade (nunca misturadas):
//
// percentual — cada parceiro leva um % do que foi efetivamente arrecadado; o que
//   sobra fica com o colégio. É o modelo original (Jazz, 70/30).
// fixo — cada parceiro tem um valor mensal GARANTIDO, que não se move quando
//   entra ou sai aluno. O colégio absorve a diferença: se arrecadou mais que a
//   soma dos fixos, sobra; se arrecadou menos, ele completa do próprio bolso.

export type TipoRepasse = "percentual" | "fixo";

export interface ParceiroModalidade {
  id: string;
  nome: string;
  // Preenchido conforme o tipo da modalidade; o outro fica nulo.
  percentualParceiro: number | null;
  valorFixoMensal: number | null;
}

export interface RepasseParceiroCalculado {
  parceiroId: string;
  parceiroNome: string;
  percentualParceiro: number | null;
  // O que a regra do cadastro produz para o mês.
  valorPadrao: number;
  // O que será pago: o ajuste manual do mês prevalece sobre o valor padrão.
  valorRepasse: number;
  ajustadoManualmente: boolean;
}

export interface RepasseModalidadeCalculado {
  tipo: TipoRepasse;
  valorArrecadado: number;
  parceiros: RepasseParceiroCalculado[];
  totalRepasse: number;
  // Arrecadado − repassado. No percentual é o retido e nunca fica negativo; no
  // fixo pode ficar negativo, e o sinal é a informação que importa.
  saldoColegio: number;
}

// Ajuste manual do mês: sobrescreve o valor de UM parceiro em UM mês, sem tocar
// no cadastro. Existe porque mês parcial (modalidade que começou no dia 15) não
// segue regra previsível de proporção — quem decide o valor é a escola.
export type AjustesDoMes = Record<string, number | null | undefined>;

export function somaPercentuais(parceiros: ParceiroModalidade[]): number {
  return arredondarCentavos(parceiros.reduce((s, p) => s + (Number(p.percentualParceiro) || 0), 0));
}

export function somaValoresFixos(parceiros: ParceiroModalidade[]): number {
  return arredondarCentavos(parceiros.reduce((s, p) => s + (Number(p.valorFixoMensal) || 0), 0));
}

export function calcularRepasseModalidade(
  tipo: TipoRepasse,
  parceiros: ParceiroModalidade[],
  valorArrecadado: number,
  ajustes: AjustesDoMes = {},
): RepasseModalidadeCalculado {
  const arrecadado = arredondarCentavos(valorArrecadado);

  const calculados = parceiros.map((p): RepasseParceiroCalculado => {
    // No percentual o valor do mês é derivado do arrecadado (regra original); no
    // fixo é o contratado, indiferente ao que entrou de mensalidade.
    const doPercentual =
      tipo === "percentual" ? calcularRepasse(arrecadado, Number(p.percentualParceiro) || 0) : null;
    const percentual = doPercentual?.percentualParceiro ?? null;
    const valorPadrao =
      doPercentual?.valorRepasse ?? arredondarCentavos(Number(p.valorFixoMensal) || 0);

    const ajuste = ajustes[p.id];
    const temAjuste = ajuste !== null && ajuste !== undefined && Number.isFinite(Number(ajuste));
    const valorRepasse = temAjuste ? arredondarCentavos(Number(ajuste)) : valorPadrao;

    return {
      parceiroId: p.id,
      parceiroNome: p.nome,
      percentualParceiro: percentual,
      valorPadrao,
      valorRepasse,
      // Só sinaliza quando o ajuste realmente mudou o valor: um ajuste igual ao
      // padrão não é uma exceção a lembrar.
      ajustadoManualmente: temAjuste && valorRepasse !== valorPadrao,
    };
  });

  const totalRepasse = arredondarCentavos(calculados.reduce((s, p) => s + p.valorRepasse, 0));
  return {
    tipo,
    valorArrecadado: arrecadado,
    parceiros: calculados,
    totalRepasse,
    saldoColegio: arredondarCentavos(arrecadado - totalRepasse),
  };
}

// ---------- Calendário do repasse fixo ----------

// Janeiro: o colégio não funciona, então nenhum mês de janeiro gera repasse,
// qualquer que seja a data de início da modalidade.
export const MES_SEM_ATIVIDADE = "01";

export type StatusMesModalidade = "ativo" | "janeiro" | "antes_do_inicio";

export function statusMesModalidade(
  mesReferencia: string,
  mesInicio: string | null | undefined,
): StatusMesModalidade {
  if (mesReferencia.slice(5, 7) === MES_SEM_ATIVIDADE) return "janeiro";
  const inicio = (mesInicio ?? "").slice(0, 7);
  if (inicio && mesReferencia < inicio) return "antes_do_inicio";
  return "ativo";
}

export function geraRepasseNoMes(
  mesReferencia: string,
  mesInicio: string | null | undefined,
): boolean {
  return statusMesModalidade(mesReferencia, mesInicio) === "ativo";
}

// Data prevista do repasse no mês. Um dia 31 configurado cai no último dia dos
// meses curtos em vez de virar data inválida (ou pular para o mês seguinte).
export function dataPrevistaRepasse(
  mesReferencia: string,
  diaPagamento: number | null | undefined,
): string | null {
  const dia = Number(diaPagamento);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) return null;
  const ano = Number(mesReferencia.slice(0, 4));
  const mes = Number(mesReferencia.slice(5, 7));
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diaFinal = Math.min(dia, ultimoDia);
  return `${mesReferencia}-${String(diaFinal).padStart(2, "0")}`;
}

// ---------- Visibilidade por modalidade ----------
// Espelha a regra do banco (can_view_modalidade_esporte): parceiro externo
// recebe o módulo 'esportes' + as modalidades dele e passa a ver SÓ elas.
// Usuário interno com o módulo e sem nenhuma modalidade vinculada vê todas.

export function restritoPorModalidade(modalidadeIdsDoUsuario: string[], isAdmin: boolean): boolean {
  return !isAdmin && modalidadeIdsDoUsuario.length > 0;
}

export function podeVerModalidade(
  modalidadeId: string,
  modalidadeIdsDoUsuario: string[],
  isAdmin: boolean,
): boolean {
  if (!restritoPorModalidade(modalidadeIdsDoUsuario, isAdmin)) return true;
  return modalidadeIdsDoUsuario.includes(modalidadeId);
}

export function modalidadesVisiveis<T extends ModalidadeVisivel>(
  modalidades: T[],
  modalidadeIdsDoUsuario: string[],
  isAdmin: boolean,
): T[] {
  if (!restritoPorModalidade(modalidadeIdsDoUsuario, isAdmin)) return modalidades;
  return modalidades.filter((m) => modalidadeIdsDoUsuario.includes(m.id));
}
