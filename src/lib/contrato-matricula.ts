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

import { parseBRLNumber } from "@/lib/currency";
import { dataPorExtenso, valorPorExtenso } from "@/lib/recibos";
import {
  MODELO_CONTRATO,
  TITULO_CONTRATO,
  type ParagrafoModelo,
} from "@/lib/contrato-matricula-modelo";
import { rotulosItensMaterial, type ItemMaterial } from "@/lib/rematricula";

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
  "ComplementoParcelasMatricula",
  "ValorMensalidade",
  "ValorMensalidadeExtenso",
  "PercentualDesconto",
  "ValorMensalidadeComDesconto",
  "ValorMensalidadeComDescontoExtenso",
  "DiaVencimentoMensalidade",
  "ListaMaterialPedagogicoSelecionado",
  "ValorTotalMaterialPedagogico",
  "NumeroParcelasMaterialPedagogico",
  "DataVencimento1aParcelaMaterialPedagogico",
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

/** Matrícula e Material como saíram no último contrato gerado (valores já formatados). */
export interface ResumoContratoGerado {
  matricula: { valor: string; parcelas: string; primeiroVencimento: string } | null;
  material: { descricao: string; valorTotal: string; parcelas: string } | null;
}

/**
 * Lê de `campos` do contrato gravado o que a aba Contratos mostra nas colunas
 * Matrícula e Material. `material: null` quando o contrato saiu com
 * TEXTO_SEM_MATERIAL (série sem material no Sponte) ou sem parcelas.
 */
export function resumoContratoGerado(campos: Partial<CamposContrato> | null): ResumoContratoGerado {
  const c = campos ?? {};
  const matricula =
    c.ValorMatricula && c.NumeroParcelasMatricula
      ? {
          valor: c.ValorMatricula,
          parcelas: c.NumeroParcelasMatricula,
          primeiroVencimento: c.DataVencimento1aParcelaMatricula ?? "",
        }
      : null;
  const semMaterial =
    !c.ListaMaterialPedagogicoSelecionado ||
    c.ListaMaterialPedagogicoSelecionado === TEXTO_SEM_MATERIAL ||
    !c.NumeroParcelasMaterialPedagogico ||
    c.NumeroParcelasMaterialPedagogico === "0";
  const material = semMaterial
    ? null
    : {
        descricao: c.ListaMaterialPedagogicoSelecionado ?? "",
        valorTotal: c.ValorTotalMaterialPedagogico ?? "",
        parcelas: c.NumeroParcelasMaterialPedagogico ?? "",
      };
  return { matricula, material };
}
/** Material lançado no Sponte sem itens do kit cadastrados para unidade × ano × série. */
export const TEXTO_MATERIAL_SEM_ITENS = "Material Pedagógico da série";
export const TEXTO_SEM_EXTRAS = "Não há serviços extras contratados nesta rematrícula.";

/** Testemunha do contrato (cadastro global em Configurações). */
export interface TestemunhaContrato {
  nome: string;
  cpf: string;
  email: string;
  celular: string;
}

export const PAPEIS_SIGNATARIOS = [
  "CONTRATANTE",
  "CONTRATADO",
  "TESTEMUNHA 1",
  "TESTEMUNHA 2",
] as const;
export type PapelSignatario = (typeof PAPEIS_SIGNATARIOS)[number];

/** Signatário que vai para a ZapSign, na ordem de PAPEIS_SIGNATARIOS. */
export interface SignatarioContrato {
  papel: PapelSignatario;
  nome: string;
  email: string;
  telefone: string;
  cpf: string;
}

// ─── Extras (contas a receber do Sponte) ────────────────────────────────────

/** Categorias recorrentes aceitas como EXTRAS, na ordem em que saem no texto. */
export const CATEGORIAS_EXTRAS = [
  "Hora Extra",
  "Lanche da Manhã",
  "Almoço",
  "Lanche da Tarde",
  "Jantar",
] as const;
export type CategoriaExtra = (typeof CATEGORIAS_EXTRAS)[number];

export interface TituloExtras {
  /** Título (ContaReceberID) que agrupa as parcelas; usado pelo Material. */
  contaReceberID?: string;
  categoria: string;
  /** YYYY-MM-DD */
  vencimento: string;
  valor: number;
  situacao: string;
  quitada: boolean;
}

export interface ExtrasContrato {
  /** Categorias distintas encontradas, na ordem de CATEGORIAS_EXTRAS. */
  categorias: CategoriaExtra[];
  /** Valor mensal de cada categoria contratada (parcela vigente). */
  valorPorCategoria: Partial<Record<CategoriaExtra, number>>;
  /** Soma dos valores mensais (uma parcela vigente por categoria). */
  valorMensal: number;
  /**
   * Texto da cláusula antes do total: "Hora Extra (R$…, das 11:00 às 13:00, de
   * segunda a sexta-feira), Almoço (…) e Jantar (…)" quando detalhado pelo
   * Diário, "Hora Extra, Almoço e Jantar" sem detalhe, ou o fallback.
   */
  lista: string;
  /** Divergências Sponte × Diário encontradas ao detalhar (nunca bloqueiam). */
  avisos: string[];
}

function chaveCategoria(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function categoriaExtra(categoria: string): CategoriaExtra | null {
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

  const categorias: CategoriaExtra[] = [];
  const valorPorCategoria: Partial<Record<CategoriaExtra, number>> = {};
  let totalCentavos = 0;
  for (const cat of CATEGORIAS_EXTRAS) {
    const lista = porCategoria.get(cat);
    if (!lista?.length) continue;
    const primeira = [...lista].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
    categorias.push(cat);
    valorPorCategoria[cat] = centavos(primeira.valor) / 100;
    totalCentavos += centavos(primeira.valor);
  }

  return {
    categorias,
    valorPorCategoria,
    valorMensal: totalCentavos / 100,
    lista: categorias.length ? listarComE(categorias) : TEXTO_SEM_EXTRAS,
    avisos: [],
  };
}

// ─── Material Pedagógico (contas a receber do Sponte) ───────────────────────

export const CATEGORIA_MATERIAL = "Material Pedagógico";

export interface MaterialSponte {
  /** Soma das parcelas do título (centavos exatos). */
  valorTotal: number;
  parcelas: number;
  /** YYYY-MM-DD da parcela de menor vencimento. */
  primeiroVencimento: string;
}

/**
 * Material Pedagógico lançado no Sponte para o ano letivo: um único título
 * (ContaReceberID) de categoria "Material Pedagógico" com parcelas vencendo no
 * ano dá valor total (soma), nº de parcelas e 1º vencimento. Nenhum título →
 * null (contrato usa o texto de "sem material"). Mais de um título no mesmo
 * ano é ambíguo (reposição, complementar…) e derruba a geração em vez de
 * escolher sozinho.
 */
export function materialDoContrato(
  titulos: readonly TituloExtras[],
  anoLetivo: number,
): MaterialSponte | null {
  const prefixo = `${anoLetivo}-`;
  const chaveMaterial = chaveCategoria(CATEGORIA_MATERIAL);
  const porTitulo = new Map<string, TituloExtras[]>();
  for (const t of titulos) {
    if (chaveCategoria(t.categoria) !== chaveMaterial) continue;
    if (t.valor <= 0 || !t.vencimento || tituloCancelado(t)) continue;
    if (!t.vencimento.startsWith(prefixo)) continue;
    const id = t.contaReceberID || "(sem ContaReceberID)";
    const lista = porTitulo.get(id) ?? [];
    lista.push(t);
    porTitulo.set(id, lista);
  }
  if (porTitulo.size === 0) return null;
  if (porTitulo.size > 1) {
    throw new Error(
      `Há ${porTitulo.size} títulos de Material Pedagógico em ${anoLetivo} no Sponte (${[...porTitulo.keys()].join(", ")}); ajuste no Sponte antes de gerar o contrato.`,
    );
  }
  const parcelas = [...porTitulo.values()][0].sort((a, b) =>
    a.vencimento.localeCompare(b.vencimento),
  );
  return {
    valorTotal: parcelas.reduce((s, p) => s + centavos(p.valor), 0) / 100,
    parcelas: parcelas.length,
    primeiroVencimento: parcelas[0].vencimento,
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
  /** Contato PESSOAL do representante (assina na ZapSign). */
  representanteEmail: string;
  representanteCelular: string;
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
  /** Itens inclusos (nome + volumes) cadastrados para unidade × ano × série. */
  itens: ItemMaterial[];
  valorTotal: number;
  parcelas: number;
  /** YYYY-MM-DD da 1ª parcela (título do Sponte). */
  primeiroVencimento: string;
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
  /** As duas testemunhas ativas, na ordem em que assinam. */
  testemunhas: TestemunhaContrato[];
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
    ComplementoParcelasMatricula:
      matricula.parcelas === 1
        ? "."
        : " e demais parcelas com vencimento acompanhando o dia de vencimento da mensalidade, nos meses subsequentes.",
    ValorMensalidade: numeroBR(mensalidade.valor),
    ValorMensalidadeExtenso: valorPorExtenso(mensalidade.valor),
    PercentualDesconto: percentualBR(mensalidade.descontoPercentual),
    ValorMensalidadeComDesconto: numeroBR(comDesconto),
    ValorMensalidadeComDescontoExtenso: valorPorExtenso(comDesconto),
    DiaVencimentoMensalidade: diaDoISO(mensalidade.vencimento),
    ListaMaterialPedagogicoSelecionado: !material
      ? TEXTO_SEM_MATERIAL
      : material.itens.length
        ? listarComE(rotulosItensMaterial(material.itens))
        : TEXTO_MATERIAL_SEM_ITENS,
    ValorTotalMaterialPedagogico: material ? numeroBR(material.valorTotal) : "0,00",
    NumeroParcelasMaterialPedagogico: material ? String(material.parcelas) : "0",
    DataVencimento1aParcelaMaterialPedagogico: material
      ? dataPorExtenso(material.primeiroVencimento)
      : "",
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
      ...input.testemunhas.map((t) => ({ papel: "TESTEMUNHA", nome: t.nome, cpf: t.cpf })),
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
  if (!c.representanteEmail.trim()) {
    erros.push("E-mail do representante legal (Dados dos Colégios)");
  }
  if (!c.representanteCelular.trim()) {
    erros.push("Celular do representante legal (Dados dos Colégios)");
  }
  if (input.testemunhas.length !== 2) {
    erros.push(
      `Duas testemunhas ativas (Configurações → Testemunhas do contrato; há ${input.testemunhas.length})`,
    );
  }
  input.testemunhas.forEach((t, i) => {
    const quem = t.nome.trim() || `Testemunha ${i + 1}`;
    if (!t.nome.trim()) erros.push(`Nome da testemunha ${i + 1} (Configurações)`);
    if (!t.cpf.trim()) erros.push(`CPF da testemunha ${quem} (Configurações)`);
    if (!t.email.trim()) erros.push(`E-mail da testemunha ${quem} (Configurações)`);
    if (!t.celular.trim()) erros.push(`Celular da testemunha ${quem} (Configurações)`);
  });
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

/**
 * Os 4 signatários da ZapSign, na ordem CONTRATANTE, CONTRATADO, TESTEMUNHA 1 e
 * TESTEMUNHA 2. Pressupõe `validarContrato` sem pendências: nenhum contato
 * recebe fallback (o e-mail institucional da unidade nunca assina).
 */
export function signatariosContrato(input: MontarContratoInput): SignatarioContrato[] {
  const { colegio: c, responsavel: r } = input;
  return [
    { papel: "CONTRATANTE", nome: r.nome, email: r.email, telefone: r.telefone, cpf: r.cpf },
    {
      papel: "CONTRATADO",
      nome: c.representanteNome,
      email: c.representanteEmail,
      telefone: c.representanteCelular,
      cpf: c.representanteCpf,
    },
    ...input.testemunhas.map(
      (t, i): SignatarioContrato => ({
        papel: PAPEIS_SIGNATARIOS[2 + i] ?? "TESTEMUNHA 2",
        nome: t.nome,
        email: t.email,
        telefone: t.celular,
        cpf: t.cpf,
      }),
    ),
  ];
}

export function nomeArquivoContrato(doc: ContratoMatriculaDocumento): string {
  const aluno = doc.campos.NomeAluno.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `Contrato-Matricula-${doc.numero}-${aluno}.pdf`;
}

// ─── Matrícula informada na aba Documentos ─────────────────────────────────
// Fora do portal de rematrícula não há linha em rematricula_matricula_escolhas:
// quem gera o contrato escolhe entre o valor integral da tabela do ano
// (segmento da série) e um valor manual (bolsa, negociação), e digita parcelas
// e 1º vencimento.

export interface MatriculaInformada {
  /** Valor integral da tabela para a série/ano; null quando não cadastrado. */
  valorTabela: number | null;
  /** Campo manual como digitado ("" = usar a tabela). */
  valorManual: string;
  parcelas: string;
  /** YYYY-MM-DD */
  primeiroVencimento: string;
}

export interface MatriculaResolvida {
  matricula: MatriculaContrato | null;
  origem: "tabela" | "manual" | null;
  erros: string[];
}

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

export function resolverMatriculaInformada(m: MatriculaInformada): MatriculaResolvida {
  const erros: string[] = [];
  const manual = m.valorManual.trim();
  let valor: number | null = null;
  let origem: "tabela" | "manual" | null = null;
  if (manual) {
    const n = parseBRLNumber(manual);
    if (Number.isFinite(n) && n > 0) {
      valor = n;
      origem = "manual";
    } else {
      erros.push("Valor manual da Matrícula inválido.");
    }
  } else if (m.valorTabela !== null && m.valorTabela > 0) {
    valor = m.valorTabela;
    origem = "tabela";
  } else {
    erros.push("Informe o valor da Matrícula (não há tabela de valores para a série/ano).");
  }

  const parcelas = Number(m.parcelas.trim());
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 12) {
    erros.push("Parcelas da Matrícula devem ser um inteiro entre 1 e 12.");
  }
  const venc = m.primeiroVencimento.trim();
  if (!RE_YMD.test(venc) || Number.isNaN(new Date(`${venc}T00:00:00Z`).getTime())) {
    erros.push("Data do 1º vencimento da Matrícula inválida.");
  }

  if (erros.length > 0 || valor === null) return { matricula: null, origem: null, erros };
  return { matricula: { valor, parcelas, primeiroVencimento: venc }, origem, erros: [] };
}

// ─── Base da aba Contratos ───────────────────────────────────────────────────
// A lista nasce da UNIÃO (por aluno + ano letivo) de quem finalizou pelo portal
// (rematricula_envios) com quem já tem Contrato de Matrícula gerado direto pela
// aba Documentos (contratos_matricula), sem passar pelo portal. Quem está nos
// dois conjuntos aparece uma vez, com a data do envio do portal.

export interface AlunoAnoContrato {
  alunoId: string;
  anoLetivo: number;
  /** Data do Finalizar no portal; null = só existe o contrato (aba Documentos). */
  enviadaEm: string | null;
}

export function unirBaseContratos(
  envios: readonly { alunoId: string; anoLetivo: number; enviadaEm: string }[],
  contratos: readonly { alunoId: string; anoLetivo: number }[],
): AlunoAnoContrato[] {
  const porChave = new Map<string, AlunoAnoContrato>();
  for (const e of envios) {
    porChave.set(`${e.alunoId}|${e.anoLetivo}`, {
      alunoId: e.alunoId,
      anoLetivo: e.anoLetivo,
      enviadaEm: e.enviadaEm,
    });
  }
  for (const c of contratos) {
    const chave = `${c.alunoId}|${c.anoLetivo}`;
    if (!porChave.has(chave)) {
      porChave.set(chave, { alunoId: c.alunoId, anoLetivo: c.anoLetivo, enviadaEm: null });
    }
  }
  return [...porChave.values()];
}
