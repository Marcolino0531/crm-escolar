// Declaração de Imposto de Renda (dedução de despesas com instrução): lógica
// pura de seleção dos pagamentos e montagem do documento.
//
// A declaração afirma o que a família pagou em um ano civil fechado, então os
// dois filtros são estritos: data de PAGAMENTO dentro do ano de referência e
// categoria exatamente "Matrícula" ou "Mensalidade". Nada de vencimento, nada
// de parcela em aberto, nada de material, evento ou cantina.

import {
  dataPorExtenso,
  enderecoLinha,
  formatarBRL,
  formatarDataBR,
  formatarNumeroRecibo,
  valorPorExtenso,
  type AlunoRecibo,
  type ColegioRecibo,
} from "./recibos";

/** Categorias dedutíveis, com o nome exato do plano de contas do Sponte. */
export const CATEGORIAS_IR = ["Matrícula", "Mensalidade"] as const;

export type CategoriaIR = (typeof CATEGORIAS_IR)[number];

function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const CATEGORIAS_ACEITAS = new Map<string, CategoriaIR>(
  CATEGORIAS_IR.map((c) => [normalizar(c), c]),
);

/**
 * Categoria dedutível correspondente, ou `null`. O casamento ignora caixa e
 * acento (o Sponte devolve o rótulo com variação de digitação), mas exige o
 * nome inteiro: "Material Pedagógico" e "Mensalidade Esportes" não entram.
 */
export function categoriaDedutivel(categoria: string): CategoriaIR | null {
  return CATEGORIAS_ACEITAS.get(normalizar(categoria)) ?? null;
}

/**
 * Ano civil consultado: "IR 2027" declara o que foi pago em 2026. A regra vale
 * para qualquer ano — o exercício é sempre o ano seguinte ao dos pagamentos.
 */
export function anoReferenciaIR(anoIR: number): number {
  return anoIR - 1;
}

/** Anos oferecidos no seletor: o exercício atual, o próximo e os anteriores. */
export function anosIRDisponiveis(hojeYMD: string, quantidade = 5): number[] {
  const atual = Number(hojeYMD.slice(0, 4));
  const inicio = atual + 1;
  return Array.from({ length: quantidade }, (_, i) => inicio - i);
}

/** Exercício sugerido por padrão: o que está sendo declarado hoje. */
export function anoIRPadrao(hojeYMD: string): number {
  return Number(hojeYMD.slice(0, 4));
}

// Subconjunto do que `coletarTitulosAluno` devolve — só o que a seleção usa.
export interface ParcelaIR {
  categoria: string;
  numeroParcela: string;
  valorPago: number;
  dataPagamento: string; // YYYY-MM-DD ("" quando não houve baixa)
}

export interface PagamentoIR {
  dataPagamento: string; // YYYY-MM-DD
  categoria: CategoriaIR;
  parcela: string; // "" quando o Sponte não informa
  valor: number;
}

function paraCentavos(valor: number): number {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100);
}

/**
 * Pagamentos que entram na declaração do exercício `anoIR`, em ordem
 * cronológica: baixados dentro do ano civil de referência, com valor pago
 * positivo e categoria dedutível.
 */
export function pagamentosIR(parcelas: readonly ParcelaIR[], anoIR: number): PagamentoIR[] {
  const ano = anoReferenciaIR(anoIR);
  const inicio = `${ano}-01-01`;
  const fim = `${ano}-12-31`;

  const linhas: PagamentoIR[] = [];
  for (const p of parcelas) {
    const data = (p.dataPagamento ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
    if (data < inicio || data > fim) continue;
    const categoria = categoriaDedutivel(p.categoria);
    if (!categoria) continue;
    const centavos = paraCentavos(p.valorPago);
    if (centavos <= 0) continue;
    linhas.push({
      dataPagamento: data,
      categoria,
      parcela: (p.numeroParcela ?? "").trim(),
      valor: centavos / 100,
    });
  }

  linhas.sort(
    (a, b) =>
      a.dataPagamento.localeCompare(b.dataPagamento) || a.categoria.localeCompare(b.categoria),
  );
  return linhas;
}

/** Total do ano: soma em centavos das linhas impressas, sem arraste binário. */
export function totalPagamentosIR(pagamentos: readonly PagamentoIR[]): number {
  return pagamentos.reduce((acc, p) => acc + paraCentavos(p.valor), 0) / 100;
}

export interface DeclaracaoIRDocumento {
  numero: string;
  anoIR: number;
  anoReferencia: number;
  dataDocumento: string; // YYYY-MM-DD escolhida pelo usuário
  dataExtenso: string; // "Belo Horizonte, 14 de agosto de 2026"
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsavelNome: string;
  responsavelCpf: string;
  pagamentos: PagamentoIR[];
  total: number;
  totalFormatado: string;
  totalExtenso: string;
  texto: string;
  enderecoColegio: string;
  contatoColegio: string;
}

export interface MontarDeclaracaoIRInput {
  numero: number;
  anoIR: number;
  dataDocumento: string;
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsavelNome: string;
  responsavelCpf: string;
  parcelas: readonly ParcelaIR[];
}

function juntar(partes: readonly string[], sep: string): string {
  return partes
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(sep);
}

/** Frase de abertura: quem declara, para quem e de que ano. */
export function textoDeclaracaoIR(input: {
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsavelNome: string;
  responsavelCpf: string;
  anoReferencia: number;
  total: number;
}): string {
  const { colegio } = input;
  const nome = colegio.nomeFantasia.trim();
  const razao = colegio.razaoSocial.trim();
  const cabeca = nome && razao && nome !== razao ? `${nome} - ${razao}` : nome || razao;

  const partes: string[] = [cabeca ? `COLÉGIO ${cabeca}` : "COLÉGIO"];
  if (colegio.cnpj.trim()) partes.push(`inscrito no CNPJ n° ${colegio.cnpj.trim()}`);
  const endereco = enderecoLinha(colegio);
  if (endereco) partes.push(`localizado na ${endereco}`);

  const pagador = juntar(
    [
      input.responsavelNome.trim(),
      input.responsavelCpf.trim() ? `CPF ${input.responsavelCpf.trim()}` : "",
    ],
    ", ",
  );
  const quem = pagador ? `${pagador}, responsável financeiro` : "o responsável financeiro";

  return (
    `${partes.join(", ")}, declara para fins de comprovação junto à Receita Federal que ` +
    `${quem} do(a) aluno(a) ${input.aluno.nome.trim()}, pagou a esta instituição, ` +
    `no ano-calendário de ${input.anoReferencia}, o valor total de ` +
    `${formatarBRL(input.total)} (${valorPorExtenso(input.total)}) a título de despesas com ` +
    "instrução (matrícula e mensalidades), conforme discriminado abaixo."
  );
}

export function montarDeclaracaoIR(input: MontarDeclaracaoIRInput): DeclaracaoIRDocumento {
  const anoReferencia = anoReferenciaIR(input.anoIR);
  const pagamentos = pagamentosIR(input.parcelas, input.anoIR);
  const total = totalPagamentosIR(pagamentos);
  return {
    numero: formatarNumeroRecibo(input.numero, input.dataDocumento),
    anoIR: input.anoIR,
    anoReferencia,
    dataDocumento: input.dataDocumento,
    dataExtenso: juntar([input.colegio.cidade, dataPorExtenso(input.dataDocumento)], ", "),
    colegio: input.colegio,
    aluno: input.aluno,
    responsavelNome: input.responsavelNome,
    responsavelCpf: input.responsavelCpf,
    pagamentos,
    total,
    totalFormatado: formatarBRL(total),
    totalExtenso: valorPorExtenso(total),
    texto: textoDeclaracaoIR({
      colegio: input.colegio,
      aluno: input.aluno,
      responsavelNome: input.responsavelNome,
      responsavelCpf: input.responsavelCpf,
      anoReferencia,
      total,
    }),
    enderecoColegio: enderecoLinha(input.colegio),
    contatoColegio: juntar(
      [input.colegio.telefone, input.colegio.email, input.colegio.site],
      " · ",
    ),
  };
}

/** Impedimentos de emissão (lista vazia = pode gerar). */
export function validarDeclaracaoIR(input: {
  colegio: ColegioRecibo | null;
  aluno: AlunoRecibo | null;
  dataDocumento: string;
  pagamentos: readonly PagamentoIR[];
}): string[] {
  const erros: string[] = [];
  if (!input.colegio || !input.colegio.razaoSocial.trim()) {
    erros.push("Cadastre a razão social do colégio em Configuração dos Colégios.");
  }
  if (!input.colegio || !input.colegio.cnpj.trim()) {
    erros.push("Cadastre o CNPJ do colégio em Configuração dos Colégios.");
  }
  if (!input.aluno) erros.push("Selecione o aluno.");
  if (!formatarDataBR(input.dataDocumento)) erros.push("Informe a data do documento.");
  if (input.pagamentos.length === 0) {
    erros.push("Nenhum pagamento de Matrícula ou Mensalidade no ano selecionado.");
  }
  return erros;
}

export function nomeArquivoDeclaracaoIR(doc: DeclaracaoIRDocumento): string {
  const aluno = doc.aluno.nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
  return `declaracao-ir-${doc.anoIR}-${doc.numero.replace("/", "-")}-${
    aluno || doc.aluno.alunoId
  }.pdf`;
}
