// Lógica PURA do Contrato de Matrícula/Rematrícula: preenche os campos do
// modelo DOCX a partir dos dados persistidos (escolhas do portal), do Sponte
// (aluno, responsável financeiro, mensalidade, contas a receber) e dos Dados
// dos Colégios da unidade do aluno. Nada aqui acessa rede ou banco — o gerador
// de PDF e as server functions só consomem o `ContratoMatriculaDocumento`.
//
// IMPORTANTE (extras): «ListaExtrasSelecionados» e «ValorTotalExtrasMensal»
// são um RETRATO do contas a receber do aluno no Sponte NO MOMENTO da geração.
// Se o responsável contratar/cancelar Hora Extra ou alimentação depois de
// assinar, o documento já assinado NÃO é atualizado — a cobrança segue o
// Sponte; o contrato registra apenas o que estava vigente na data da geração.

import { dataPorExtenso, valorPorExtenso } from "@/lib/recibos";
import {
  MODELO_CONTRATO,
  TITULO_CONTRATO,
  type ParagrafoModelo,
} from "@/lib/contrato-matricula-modelo";

export const CAMPOS_CONTRATO = [
  "NumeroContrato",
  "RazaoSocialColegio",
  "CNPJColegio",
  "EnderecoColegio",
  "CEPColegio",
  "EmailColegio",
  "NomeRepresentanteLegal",
  "CPFRepresentanteLegal",
  "NomeResponsavel",
  "CPFResponsavel",
  "EnderecoResponsavel",
  "NumeroEnderecoResponsavel",
  "CompEnderecoResponsavel",
  "BairroResponsavel",
  "CidadeResponsavel",
  "EstadoResponsavel",
  "CEPResponsavel",
  "NomeAluno",
  "CursoAtual",
  "ValorMatricula",
  "ValorMatriculaExtenso",
  "NumeroParcelasMatricula",
  "DataVencimento1aParcelaMatricula",
  "ValorMensalidade",
  "ValorMensalidadeExtenso",
  "PercentualDesconto",
  "ValorMensalidadeComDesconto",
  "ValorMensalidadeComDescontoExtenso",
  "DiaVencimentoMensalidade",
  "ListaMaterialPedagogicoSelecionado",
  "ValorTotalMaterialPedagogico",
  "NumeroParcelasMaterialPedagogico",
  "ListaExtrasSelecionados",
  "ValorTotalExtrasMensal",
  "PercentualBolsaMensalidade",
  "DiaAtual",
  "MesAtualExtenso",
  "AnoAtual",
] as const;

export type CampoContrato = (typeof CAMPOS_CONTRATO)[number];
export type CamposContrato = Record<CampoContrato, string>;

export const TEXTO_SEM_MATERIAL = "Não há material pedagógico contratado nesta matrícula.";
export const TEXTO_SEM_EXTRAS = "Não há serviços extras contratados nesta rematrícula.";

export const TESTEMUNHAS_CONTRATO: readonly { nome: string; cpf: string }[] = [
  { nome: "Márcia Regina Ribeiro Marcolino", cpf: "631.466.656-20" },
  { nome: "Anna Clara Marcolino Ribeiro", cpf: "157.432.546-99" },
];

// ─── Extras (contas a receber do Sponte) ────────────────────────────────────

/** Categorias recorrentes aceitas como EXTRAS, na ordem em que saem no texto. */
export const CATEGORIAS_EXTRAS = [
  "Hora Extra",
  "Lanche da Manhã",
  "Almoço",
  "Lanche da Tarde",
  "Jantar",
] as const;

export interface TituloExtras {
  categoria: string;
  /** YYYY-MM-DD */
  vencimento: string;
  valor: number;
  situacao: string;
  quitada: boolean;
}

export interface ExtrasContrato {
  /** Categorias distintas encontradas, na ordem de CATEGORIAS_EXTRAS. */
  categorias: string[];
  /** Soma dos valores mensais (uma parcela vigente por categoria). */
  valorMensal: number;
  /** "Hora Extra, Almoço e Jantar" ou o texto de fallback. */
  lista: string;
}

function chaveCategoria(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function categoriaExtra(categoria: string): (typeof CATEGORIAS_EXTRAS)[number] | null {
  const chave = chaveCategoria(categoria);
  return CATEGORIAS_EXTRAS.find((c) => chaveCategoria(c) === chave) ?? null;
}

function tituloCancelado(t: TituloExtras): boolean {
  return /cancel|inativ|estorn/i.test(t.situacao);
}

/** "A, B e C" — vírgulas e "e" antes do último. */
export function listarComE(itens: readonly string[]): string {
  if (itens.length === 0) return "";
  if (itens.length === 1) return itens[0];
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

function centavos(valor: number): number {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100);
}

/**
 * Extras do ano letivo do contrato lidos do contas a receber: por categoria
 * aceita, a primeira parcela com vencimento naquele ano dá o valor mensal.
 * Parcelas de outros anos, canceladas/estornadas e categorias fora da lista
 * são ignoradas. Retrato do momento da geração.
 */
export function extrasDoContrato(
  titulos: readonly TituloExtras[],
  anoLetivo: number,
): ExtrasContrato {
  const prefixo = `${anoLetivo}-`;
  const porCategoria = new Map<string, TituloExtras[]>();
  for (const t of titulos) {
    const cat = categoriaExtra(t.categoria);
    if (!cat || t.valor <= 0 || !t.vencimento || tituloCancelado(t)) continue;
    if (!t.vencimento.startsWith(prefixo)) continue;
    const lista = porCategoria.get(cat) ?? [];
    lista.push(t);
    porCategoria.set(cat, lista);
  }

  const categorias: string[] = [];
  let totalCentavos = 0;
  for (const cat of CATEGORIAS_EXTRAS) {
    const lista = porCategoria.get(cat);
    if (!lista?.length) continue;
    const primeira = [...lista].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
    categorias.push(cat);
    totalCentavos += centavos(primeira.valor);
  }

  return {
    categorias,
    valorMensal: totalCentavos / 100,
    lista: categorias.length ? listarComE(categorias) : TEXTO_SEM_EXTRAS,
  };
}

// ─── Entrada e montagem dos campos ──────────────────────────────────────────

export interface ColegioContrato {
  unidade: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  email: string;
  representanteNome: string;
  representanteCpf: string;
}

export interface ResponsavelContrato {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export interface MatriculaContrato {
  valor: number;
  parcelas: number;
  /** YYYY-MM-DD */
  primeiroVencimento: string;
}

export interface MensalidadeContrato {
  /** Valor integral (sem desconto). */
  valor: number;
  /** Percentual da bolsa (30 = 30%). */
  descontoPercentual: number;
  /** YYYY-MM-DD da parcela vigente — define o dia de vencimento. */
  vencimento: string;
}

export interface MaterialContrato {
  itens: string[];
  valorTotal: number;
  parcelas: number;
}

export interface MontarContratoInput {
  numeroContrato: string;
  anoLetivo: number;
  colegio: ColegioContrato;
  responsavel: ResponsavelContrato;
  alunoNome: string;
  serie: string;
  matricula: MatriculaContrato;
  mensalidade: MensalidadeContrato;
  material: MaterialContrato | null;
  extras: ExtrasContrato;
  /** YYYY-MM-DD da geração (Brasília). */
  hojeISO: string;
}

/** "1.234,56" — o modelo já traz o "R$" antes do campo. */
export function numeroBR(valor: number): string {
  return (centavos(valor) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "30" / "7,5" — sem o símbolo, o modelo traz o "%". */
export function percentualBR(valor: number): string {
  const arredondado = Math.round(valor * 100) / 100;
  return arredondado.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function valorComDesconto(valor: number, descontoPercentual: number): number {
  const total = centavos(valor);
  return Math.round((total * (100 - descontoPercentual)) / 100) / 100;
}

function juntar(partes: (string | undefined)[], sep: string): string {
  return partes
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(sep);
}

function enderecoColegio(c: ColegioContrato): string {
  return juntar(
    [juntar([c.endereco, c.numero], ", "), c.complemento, c.bairro, juntar([c.cidade, c.uf], "/")],
    ", ",
  );
}

function diaDoISO(iso: string): string {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(iso ?? "");
  return m ? String(Number(m[1])) : "";
}

const SIGLA_UNIDADE: Record<string, string> = {
  CEC: "CEC",
  "CEC Baby": "CECB",
  "Núcleo Belvedere": "NBV",
  "Núcleo Vale do Sereno": "NVS",
};

/** Ex.: "2027-CEC-12345" — único por (unidade, aluno, ano letivo). */
export function numeroContrato(unidade: string, alunoId: string, anoLetivo: number): string {
  const sigla = SIGLA_UNIDADE[unidade] ?? unidade.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  return `${anoLetivo}-${sigla}-${alunoId}`;
}

export function montarCamposContrato(input: MontarContratoInput): CamposContrato {
  const { colegio: c, responsavel: r, matricula, mensalidade, material, extras } = input;
  const comDesconto = valorComDesconto(mensalidade.valor, mensalidade.descontoPercentual);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.hojeISO);
  const dataExtenso = dataPorExtenso(input.hojeISO).split(" de ");

  return {
    NumeroContrato: input.numeroContrato,
    RazaoSocialColegio: c.razaoSocial || c.nomeFantasia,
    CNPJColegio: c.cnpj,
    EnderecoColegio: enderecoColegio(c),
    CEPColegio: c.cep,
    EmailColegio: c.email,
    NomeRepresentanteLegal: c.representanteNome,
    CPFRepresentanteLegal: c.representanteCpf,
    NomeResponsavel: r.nome,
    CPFResponsavel: r.cpf,
    EnderecoResponsavel: r.endereco,
    NumeroEnderecoResponsavel: r.numero || "s/n",
    CompEnderecoResponsavel: r.complemento || "sem complemento",
    BairroResponsavel: r.bairro,
    CidadeResponsavel: r.cidade,
    EstadoResponsavel: r.uf,
    CEPResponsavel: r.cep,
    NomeAluno: input.alunoNome,
    CursoAtual: input.serie,
    ValorMatricula: numeroBR(matricula.valor),
    ValorMatriculaExtenso: valorPorExtenso(matricula.valor),
    NumeroParcelasMatricula: String(matricula.parcelas),
    DataVencimento1aParcelaMatricula: dataPorExtenso(matricula.primeiroVencimento),
    ValorMensalidade: numeroBR(mensalidade.valor),
    ValorMensalidadeExtenso: valorPorExtenso(mensalidade.valor),
    PercentualDesconto: percentualBR(mensalidade.descontoPercentual),
    ValorMensalidadeComDesconto: numeroBR(comDesconto),
    ValorMensalidadeComDescontoExtenso: valorPorExtenso(comDesconto),
    DiaVencimentoMensalidade: diaDoISO(mensalidade.vencimento),
    ListaMaterialPedagogicoSelecionado: material ? listarComE(material.itens) : TEXTO_SEM_MATERIAL,
    ValorTotalMaterialPedagogico: material ? numeroBR(material.valorTotal) : "0,00",
    NumeroParcelasMaterialPedagogico: material ? String(material.parcelas) : "0",
    ListaExtrasSelecionados: extras.lista,
    ValorTotalExtrasMensal: numeroBR(extras.valorMensal),
    PercentualBolsaMensalidade:
      mensalidade.descontoPercentual > 0
        ? `${percentualBR(mensalidade.descontoPercentual)}%`
        : "Não há bolsa de desconto",
    DiaAtual: m ? String(Number(m[3])) : "",
    MesAtualExtenso: dataExtenso[1] ?? "",
    AnoAtual: m ? m[1] : "",
  };
}

/** Troca cada «Campo» pelo valor; campo desconhecido fica visível para denunciar o erro. */
export function preencherModelo(texto: string, campos: CamposContrato): string {
  return texto.replace(/«([A-Za-z0-9]+)»/g, (_, nome: string) =>
    nome in campos ? campos[nome as CampoContrato] : `«${nome}»`,
  );
}

export interface ParagrafoContrato {
  tipo: "titulo" | "paragrafo";
  texto: string;
}

export interface AssinaturaContrato {
  papel: string;
  nome: string;
  cpf: string;
}

export interface ContratoMatriculaDocumento {
  titulo: string;
  numero: string;
  campos: CamposContrato;
  paragrafos: ParagrafoContrato[];
  /** "Belo Horizonte, 14 de setembro de 2026." */
  fecho: string;
  assinaturas: AssinaturaContrato[];
}

function renderizarParagrafo(
  p: ParagrafoModelo,
  campos: CamposContrato,
  input: MontarContratoInput,
): ParagrafoContrato {
  if (p.tipo === "bloco") {
    if (p.chave === "material" && !input.material) {
      return { tipo: "paragrafo", texto: `MATERIAL PEDAGÓGICO: ${TEXTO_SEM_MATERIAL}` };
    }
    if (p.chave === "extras" && input.extras.categorias.length === 0) {
      return { tipo: "paragrafo", texto: `EXTRAS: ${TEXTO_SEM_EXTRAS}` };
    }
    return { tipo: "paragrafo", texto: preencherModelo(p.texto, campos) };
  }
  return { tipo: p.tipo, texto: preencherModelo(p.texto, campos) };
}

export function montarContratoMatricula(input: MontarContratoInput): ContratoMatriculaDocumento {
  const campos = montarCamposContrato(input);
  return {
    titulo: TITULO_CONTRATO,
    numero: input.numeroContrato,
    campos,
    paragrafos: MODELO_CONTRATO.map((p) => renderizarParagrafo(p, campos, input)),
    fecho: `Belo Horizonte, ${campos.DiaAtual} de ${campos.MesAtualExtenso} de ${campos.AnoAtual}.`,
    assinaturas: [
      { papel: "CONTRATANTE", nome: campos.NomeResponsavel, cpf: campos.CPFResponsavel },
      {
        papel: `CONTRATADO: ${campos.RazaoSocialColegio}`,
        nome: campos.NomeRepresentanteLegal,
        cpf: campos.CPFRepresentanteLegal,
      },
      ...TESTEMUNHAS_CONTRATO.map((t) => ({ papel: "TESTEMUNHA", nome: t.nome, cpf: t.cpf })),
    ],
  };
}

/** Campos do modelo que ficaram sem valor — o contrato não sai com lacuna. */
export function validarContrato(input: MontarContratoInput): string[] {
  const erros: string[] = [];
  const c = input.colegio;
  if (!c.razaoSocial.trim() && !c.nomeFantasia.trim()) erros.push("Razão social do colégio");
  if (!c.cnpj.trim()) erros.push("CNPJ do colégio");
  if (!c.representanteNome.trim()) erros.push("Representante Legal (Dados dos Colégios)");
  if (!c.representanteCpf.trim()) erros.push("CPF do representante legal (Dados dos Colégios)");
  if (!input.responsavel.nome.trim()) erros.push("Nome do responsável financeiro");
  if (!input.responsavel.cpf.trim()) erros.push("CPF do responsável financeiro");
  if (!input.responsavel.email.trim()) erros.push("E-mail do responsável financeiro (signatário)");
  if (!input.alunoNome.trim()) erros.push("Nome do aluno");
  if (!input.serie.trim()) erros.push("Série");
  if (!(input.matricula.valor > 0)) erros.push("Valor da matrícula");
  if (!(input.matricula.parcelas >= 1)) erros.push("Parcelas da matrícula");
  if (!input.matricula.primeiroVencimento) erros.push("Vencimento da 1ª parcela da matrícula");
  if (!(input.mensalidade.valor > 0)) erros.push("Mensalidade vigente no Sponte");
  if (!input.mensalidade.vencimento) erros.push("Dia de vencimento da mensalidade");
  if (input.material && !(input.material.valorTotal > 0)) erros.push("Valor do material");
  return erros;
}

export function nomeArquivoContrato(doc: ContratoMatriculaDocumento): string {
  const aluno = doc.campos.NomeAluno.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `Contrato-Matricula-${doc.numero}-${aluno}.pdf`;
}
