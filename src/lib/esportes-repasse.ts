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
  aluno: { alunoId: string; alunoNome: string },
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
  };
}

export function totalArrecadado(pagamentos: PagamentoAlunoModalidade[]): number {
  return arredondarCentavos(pagamentos.reduce((s, p) => s + (Number(p.valorPago) || 0), 0));
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
