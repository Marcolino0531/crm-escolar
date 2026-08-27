// Lógica pura do recibo do módulo Documentos: tópicos de valor, soma do total,
// valor por extenso e montagem do documento a partir do colégio cadastrado + do
// que o Sponte devolve do aluno e do responsável escolhido.
//
// Tudo aqui é puro de propósito: o `ReciboDocumento` montado é exatamente o que
// vai para o PDF e o que é guardado como snapshot no histórico, então
// reimprimir um recibo antigo não depende de reconsultar o Sponte nem do
// cadastro atual do colégio.

export interface TopicoRecibo {
  id: string;
  descricao: string;
}

// Tópicos predefinidos, alinhados às cobranças que já existem no sistema
// (mensalidade e material do Sponte, uniforme, colônia, esportes, hora extra).
// Todos começam zerados na tela: entram no recibo só os que o usuário preencher.
export const TOPICOS_RECIBO: readonly TopicoRecibo[] = [
  { id: "mensalidade", descricao: "Mensalidade" },
  { id: "matricula", descricao: "Matrícula" },
  { id: "material_pedagogico", descricao: "Material Pedagógico" },
  { id: "material_didatico", descricao: "Material Didático" },
  { id: "uniforme", descricao: "Uniforme" },
  { id: "colonia", descricao: "Colônia de Férias" },
  { id: "esportes", descricao: "Esportes Extracurriculares" },
  { id: "hora_extra", descricao: "Hora Extra" },
  { id: "taxa", descricao: "Taxas e Serviços" },
  { id: "outros", descricao: "Outros" },
] as const;

export interface ItemRecibo {
  id: string;
  descricao: string;
  valor: number;
}

export interface ColegioRecibo {
  unidade: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  inscricaoMunicipal: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  telefone: string;
  email: string;
  site: string;
  assinanteNome: string;
  assinanteCargo: string;
  observacao: string;
}

export interface AlunoRecibo {
  alunoId: string;
  nome: string;
  cpf: string;
  turma: string;
  matricula: string;
}

export interface ResponsavelRecibo {
  responsavelId: string;
  nome: string;
  cpf: string;
  parentesco: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  cep: string;
  email: string;
  telefone: string;
  financeiro: boolean;
}

export interface ReciboDocumento {
  numero: string;
  dataRecibo: string; // YYYY-MM-DD (a data escolhida pelo usuário)
  dataExtenso: string; // "Belo Horizonte, 14 de agosto de 2026"
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsavel: ResponsavelRecibo;
  itens: ItemRecibo[];
  total: number;
  totalFormatado: string;
  totalExtenso: string;
  enderecoColegio: string;
  contatoColegio: string;
  enderecoResponsavel: string;
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function formatarBRL(valor: number): string {
  // Intl separa "R$" do número com espaço estreito não separável, que o jsPDF
  // desenha como caractere ausente — daí a normalização para espaço comum.
  return valor
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })
    .replace(/\u00a0|\u202f/g, " ");
}

// Centavos como inteiro: soma de valores digitados em reais acumula erro de
// ponto flutuante (0.1 + 0.2), e o total do recibo tem de fechar com a soma das
// linhas impressas.
function paraCentavos(valor: number): number {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100);
}

/**
 * Itens que efetivamente compõem o recibo: apenas os tópicos com valor
 * positivo, na ordem em que aparecem no formulário. Tópico zerado (ou negativo,
 * ou não numérico) fica de fora do documento.
 */
export function itensDoRecibo(
  valores: Record<string, number>,
  topicos: readonly TopicoRecibo[] = TOPICOS_RECIBO,
): ItemRecibo[] {
  const itens: ItemRecibo[] = [];
  for (const topico of topicos) {
    const centavos = paraCentavos(valores[topico.id] ?? 0);
    if (centavos <= 0) continue;
    itens.push({ id: topico.id, descricao: topico.descricao, valor: centavos / 100 });
  }
  return itens;
}

/** Total do recibo: soma dos itens preenchidos, em centavos, sem arraste binário. */
export function calcularTotalRecibo(itens: readonly ItemRecibo[]): number {
  const centavos = itens.reduce((acc, item) => acc + paraCentavos(item.valor), 0);
  return centavos / 100;
}

const UNIDADES_EXTENSO = [
  "",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const DEZENAS_EXTENSO = [
  "",
  "",
  "vinte",
  "trinta",
  "quarenta",
  "cinquenta",
  "sessenta",
  "setenta",
  "oitenta",
  "noventa",
];
const CENTENAS_EXTENSO = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];

function trioExtenso(n: number): string {
  if (n === 100) return "cem";
  const partes: string[] = [];
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  if (centena) partes.push(CENTENAS_EXTENSO[centena]);
  if (resto) {
    if (resto < 20) partes.push(UNIDADES_EXTENSO[resto]);
    else {
      const dezena = Math.floor(resto / 10);
      const unidade = resto % 10;
      partes.push(
        unidade
          ? `${DEZENAS_EXTENSO[dezena]} e ${UNIDADES_EXTENSO[unidade]}`
          : DEZENAS_EXTENSO[dezena],
      );
    }
  }
  return partes.join(" e ");
}

function inteiroExtenso(n: number): string {
  if (n === 0) return "zero";
  const grupos: { valor: number; singular: string; plural: string }[] = [
    { valor: 1_000_000_000, singular: "bilhão", plural: "bilhões" },
    { valor: 1_000_000, singular: "milhão", plural: "milhões" },
    { valor: 1_000, singular: "mil", plural: "mil" },
    { valor: 1, singular: "", plural: "" },
  ];
  const partes: string[] = [];
  let restante = n;
  for (const grupo of grupos) {
    const qtd = Math.floor(restante / grupo.valor);
    restante -= qtd * grupo.valor;
    if (!qtd) continue;
    if (grupo.valor === 1) partes.push(trioExtenso(qtd));
    else if (grupo.valor === 1_000 && qtd === 1) partes.push("mil");
    else partes.push(`${trioExtenso(qtd)} ${qtd === 1 ? grupo.singular : grupo.plural}`);
  }
  // "mil e duzentos" / "mil oitocentos e oitenta": o último grupo entra ligado
  // por "e" quando é menor que cem ou centena redonda, e solto no resto.
  if (partes.length <= 1) return partes.join("");
  const ultimo = partes[partes.length - 1];
  const inicio = partes.slice(0, -1).join(" ");
  const restoFinal = n % 1000;
  const ligaComE = restoFinal > 0 && (restoFinal < 100 || restoFinal % 100 === 0);
  return `${inicio}${ligaComE ? " e " : " "}${ultimo}`;
}

/** Valor monetário por extenso, como exigido em recibo ("mil e duzentos reais"). */
export function valorPorExtenso(valor: number): string {
  const centavosTotais = paraCentavos(Math.abs(valor));
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes: string[] = [];
  if (reais > 0 || centavos === 0) {
    partes.push(`${inteiroExtenso(reais)} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) {
    partes.push(`${inteiroExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }
  return partes.join(" e ");
}

/** "14 de agosto de 2026" a partir de YYYY-MM-DD (sem passar por Date/UTC). */
export function dataPorExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "";
  const mes = MESES[Number(m[2]) - 1] ?? "";
  return `${Number(m[3])} de ${mes} de ${m[1]}`;
}

export function formatarDataBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Número impresso: sequencial com 5 dígitos e o ano da data do recibo. */
export function formatarNumeroRecibo(numero: number, iso: string): string {
  const ano = /^(\d{4})-/.exec(iso ?? "")?.[1] ?? "";
  const seq = String(Math.max(0, Math.trunc(numero))).padStart(5, "0");
  return ano ? `${seq}/${ano}` : seq;
}

function juntar(partes: (string | undefined)[], sep: string): string {
  return partes
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(sep);
}

/** "Rua X, 617, Sala 2 — Bairro, Cidade/UF — CEP 30.830-550" */
export function enderecoLinha(dados: {
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}): string {
  const rua = juntar([dados.endereco, dados.numero, dados.complemento], ", ");
  const local = juntar([dados.bairro, juntar([dados.cidade, dados.uf], "/")], ", ");
  const cep = dados.cep?.trim() ? `CEP ${dados.cep.trim()}` : "";
  return juntar([rua, local, cep], " — ");
}

export interface MontarReciboInput {
  numero: number;
  dataRecibo: string;
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsavel: ResponsavelRecibo;
  valores: Record<string, number>;
  topicos?: readonly TopicoRecibo[];
}

/**
 * Monta o documento final: dados do colégio (cadastro), do aluno e do
 * responsável (Sponte), itens preenchidos, total somado e a data escolhida.
 * O "local" da data é a cidade do colégio.
 */
export function montarRecibo(input: MontarReciboInput): ReciboDocumento {
  const itens = itensDoRecibo(input.valores, input.topicos ?? TOPICOS_RECIBO);
  const total = calcularTotalRecibo(itens);
  const dataExtensoBase = dataPorExtenso(input.dataRecibo);
  const cidade = input.colegio.cidade.trim();
  return {
    numero: formatarNumeroRecibo(input.numero, input.dataRecibo),
    dataRecibo: input.dataRecibo,
    dataExtenso: juntar([cidade, dataExtensoBase], ", "),
    colegio: input.colegio,
    aluno: input.aluno,
    responsavel: input.responsavel,
    itens,
    total,
    totalFormatado: formatarBRL(total),
    totalExtenso: valorPorExtenso(total),
    enderecoColegio: enderecoLinha(input.colegio),
    contatoColegio: juntar(
      [input.colegio.telefone, input.colegio.email, input.colegio.site],
      " · ",
    ),
    enderecoResponsavel: enderecoLinha(input.responsavel),
  };
}

/**
 * Impedimentos de emissão, na ordem em que o usuário deve resolvê-los. Lista
 * vazia = pode gerar.
 */
export function validarRecibo(input: {
  colegio: ColegioRecibo | null;
  aluno: AlunoRecibo | null;
  responsavel: ResponsavelRecibo | null;
  itens: readonly ItemRecibo[];
  dataRecibo: string;
}): string[] {
  const erros: string[] = [];
  if (!input.colegio || !input.colegio.razaoSocial.trim()) {
    erros.push("Cadastre a razão social do colégio em Configurações → Dados dos Colégios.");
  }
  if (!input.colegio || !input.colegio.cnpj.trim()) {
    erros.push("Cadastre o CNPJ do colégio em Configurações → Dados dos Colégios.");
  }
  if (!input.aluno) erros.push("Selecione o aluno.");
  if (!input.responsavel) erros.push("Selecione o responsável que consta no recibo.");
  if (!formatarDataBR(input.dataRecibo)) erros.push("Informe a data do recibo.");
  if (input.itens.length === 0) erros.push("Preencha o valor de pelo menos um tópico.");
  return erros;
}

/** Nome do arquivo PDF: legível e único por recibo. */
export function nomeArquivoRecibo(doc: ReciboDocumento): string {
  const aluno = doc.aluno.nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
  return `recibo-${doc.numero.replace("/", "-")}-${aluno || doc.aluno.alunoId}.pdf`;
}
