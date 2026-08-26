// Módulo Documentos — tipos de documento e a Declaração de Inexistência de
// Débitos.
//
// Mesma disciplina do recibo: tudo aqui é puro e o `DeclaracaoDocumento`
// montado é exatamente o que vai para o PDF e o que fica gravado como snapshot
// no histórico. Reimprimir uma declaração antiga não reconsulta o Sponte nem
// depende do cadastro atual do colégio.

import {
  dataPorExtenso,
  enderecoLinha,
  formatarDataBR,
  formatarNumeroRecibo,
  type AlunoRecibo,
  type ColegioRecibo,
} from "./recibos";

export type TipoDocumento = "recibo" | "declaracao_debitos";

export interface TipoDocumentoInfo {
  id: TipoDocumento;
  label: string;
}

// Catálogo dos modelos disponíveis. Novo modelo entra aqui e na tela de
// emissão; o histórico é compartilhado e não precisa de mudança.
export const TIPOS_DOCUMENTO: readonly TipoDocumentoInfo[] = [
  { id: "recibo", label: "Recibo" },
  { id: "declaracao_debitos", label: "Declaração de Inexistência de Débitos" },
] as const;

export function rotuloTipoDocumento(tipo: string): string {
  return TIPOS_DOCUMENTO.find((t) => t.id === tipo)?.label ?? "Recibo";
}

export interface ResponsavelDeclaracao {
  responsavelId: string;
  nome: string;
  cpf: string;
  parentesco: string;
}

/**
 * Nomes citados na filiação, na ordem pai → mãe → demais responsáveis, sem
 * repetir nome. O Sponte nem sempre traz os dois pais: quem não existe
 * simplesmente não é citado.
 */
export function nomesFiliacao(responsaveis: readonly ResponsavelDeclaracao[]): string[] {
  const peso = (parentesco: string): number => {
    const p = (parentesco ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (p === "pai") return 0;
    if (p === "mae") return 1;
    return 2;
  };
  const ordenados = responsaveis
    .filter((r) => (r.nome ?? "").trim() !== "")
    .map((r, i) => ({ r, i }))
    .sort((a, b) => peso(a.r.parentesco) - peso(b.r.parentesco) || a.i - b.i)
    .map(({ r }) => r.nome.trim());
  return [...new Set(ordenados)];
}

/**
 * "filho(a) de Ana e João" · "filho(a) de Ana" · "" quando o aluno não tem
 * responsável cadastrado (a frase da declaração omite a filiação inteira, sem
 * deixar "e" nem espaço sobrando).
 */
export function fraseFiliacao(responsaveis: readonly ResponsavelDeclaracao[]): string {
  const nomes = nomesFiliacao(responsaveis);
  if (nomes.length === 0) return "";
  const texto =
    nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `filho(a) de ${texto}`;
}

/** Identificação do colégio na abertura da declaração. */
export function identificacaoColegio(colegio: ColegioRecibo): string {
  const nome = colegio.nomeFantasia.trim();
  const razao = colegio.razaoSocial.trim();
  const cabeca = nome && razao && nome !== razao ? `${nome} - ${razao}` : nome || razao;
  return cabeca ? `COLÉGIO ${cabeca}` : "COLÉGIO";
}

/**
 * Texto integral da declaração, montado a partir do cadastro do colégio e do
 * que o Sponte devolveu do aluno e dos responsáveis. Cada dado ausente é
 * omitido junto com sua vírgula, para não imprimir lacuna no documento.
 */
export function textoDeclaracaoDebitos(input: {
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsaveis: readonly ResponsavelDeclaracao[];
}): string {
  const { colegio, aluno } = input;
  const partes: string[] = [identificacaoColegio(colegio)];
  if (colegio.cnpj.trim()) partes.push(`inscrito no CNPJ n° ${colegio.cnpj.trim()}`);
  const endereco = enderecoLinha(colegio);
  if (endereco) partes.push(`localizado na ${endereco}`);
  if (colegio.email.trim()) partes.push(colegio.email.trim());

  const filiacao = fraseFiliacao(input.responsaveis);
  const alunoParte = [`o(a) aluno(a) ${aluno.nome.trim()}`, filiacao].filter(Boolean).join(", ");

  return (
    `${partes.join(", ")}, declara para os devidos fins que ${alunoParte}, ` +
    "não possui débitos junto a esta instituição até a presente data."
  );
}

export interface TituloAberto {
  saldo: number;
  quitada: boolean;
  vencimento: string; // YYYY-MM-DD
  valor: number;
  categoria: string;
}

export interface PendenciasAluno {
  total: number;
  vencidas: number;
  aVencer: number;
  valor: number;
}

/**
 * Parcelas ainda em aberto no Sponte: não baixadas e com saldo positivo. É a
 * checagem feita antes de emitir a declaração — havendo qualquer pendência, a
 * tela exige confirmação explícita do usuário.
 */
export function pendenciasEmAberto(
  titulos: readonly TituloAberto[],
  hojeYMD: string,
): PendenciasAluno {
  const abertas = titulos.filter((t) => !t.quitada && Math.round(t.saldo * 100) > 0);
  const vencidas = abertas.filter((t) => t.vencimento !== "" && t.vencimento < hojeYMD).length;
  const centavos = abertas.reduce((acc, t) => acc + Math.round(t.saldo * 100), 0);
  return {
    total: abertas.length,
    vencidas,
    aVencer: abertas.length - vencidas,
    valor: centavos / 100,
  };
}

/** A emissão só pode seguir sem confirmação quando não há nada em aberto. */
export function exigeConfirmacao(pendencias: PendenciasAluno): boolean {
  return pendencias.total > 0;
}

export interface DeclaracaoDocumento {
  numero: string;
  dataDocumento: string; // YYYY-MM-DD escolhida pelo usuário
  dataExtenso: string; // "Belo Horizonte, 14 de agosto de 2026"
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsaveis: ResponsavelDeclaracao[];
  texto: string;
  enderecoColegio: string;
  contatoColegio: string;
  pendencias: PendenciasAluno;
}

export interface MontarDeclaracaoInput {
  numero: number;
  dataDocumento: string;
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsaveis: readonly ResponsavelDeclaracao[];
  pendencias: PendenciasAluno;
}

export function montarDeclaracaoDebitos(input: MontarDeclaracaoInput): DeclaracaoDocumento {
  const cidade = input.colegio.cidade.trim();
  const dataExtensoBase = dataPorExtenso(input.dataDocumento);
  return {
    numero: formatarNumeroRecibo(input.numero, input.dataDocumento),
    dataDocumento: input.dataDocumento,
    dataExtenso: [cidade, dataExtensoBase].filter(Boolean).join(", "),
    colegio: input.colegio,
    aluno: input.aluno,
    responsaveis: [...input.responsaveis],
    texto: textoDeclaracaoDebitos({
      colegio: input.colegio,
      aluno: input.aluno,
      responsaveis: input.responsaveis,
    }),
    enderecoColegio: enderecoLinha(input.colegio),
    contatoColegio: [input.colegio.telefone, input.colegio.email, input.colegio.site]
      .map((p) => p.trim())
      .filter(Boolean)
      .join(" · "),
    pendencias: input.pendencias,
  };
}

/** Impedimentos de emissão (lista vazia = pode gerar). */
export function validarDeclaracao(input: {
  colegio: ColegioRecibo | null;
  aluno: AlunoRecibo | null;
  dataDocumento: string;
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
  return erros;
}

export function nomeArquivoDeclaracao(doc: DeclaracaoDocumento): string {
  const aluno = doc.aluno.nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
  return `declaracao-debitos-${doc.numero.replace("/", "-")}-${aluno || doc.aluno.alunoId}.pdf`;
}
