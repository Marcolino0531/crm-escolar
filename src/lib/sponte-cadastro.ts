// Atualização cadastral no Sponte (UpdateAlunos3 / UpdateResponsaveis2) — regras
// puras, sem I/O.
//
// O Sponte não tem update parcial: os dois métodos recebem a ficha INTEIRA e
// gravam o que vier no envelope. Um campo omitido (ou enviado vazio) pode
// apagar o dado que já estava lá. Por isso o único caminho seguro é:
//
//   1. ler a ficha completa (GetAlunos3 / GetResponsaveis2);
//   2. trocar SOMENTE os campos que o responsável editou no portal;
//   3. reenviar todos os outros com o valor original — nunca em branco;
//   4. reler e conferir campo a campo que nada mais mudou.
//
// Vínculos (nResponsavelFinanceiroID, nResponsavelDidaticoID,
// lResponsavelFinanceiro, lResponsavelDidatico) NUNCA são calculados aqui: são
// repassados exatamente como vieram na leitura. Calcular esses campos poderia
// deslocar quem recebe o boleto do aluno.

import { escapeXml } from "./sponte-plano";

// ─── Ficha do aluno (espelha os campos de UpdateAlunos3) ────────────────────

export interface FichaAlunoSponte {
  alunoId: string;
  nome: string;
  midia: string;
  dataNascimento: string; // YYYY-MM-DD ("" quando o Sponte não informa)
  cidade: string;
  bairro: string;
  cep: string;
  endereco: string;
  numeroEndereco: string;
  complementoEndereco: string;
  cpf: string;
  rg: string;
  responsavelFinanceiroId: string;
  responsavelDidaticoId: string;
  email: string;
  telefone: string;
  celular: string;
  observacao: string;
  sexo: string;
  profissao: string;
  cidadeNatal: string;
  ra: string;
  numeroMatricula: string;
  situacao: string;
  cursoInteresse: string;
  infoBloqueada: string;
  origemNome: string;
  origemId: string;
}

// ─── Ficha do responsável (espelha os campos de UpdateResponsaveis2) ────────

export interface FichaResponsavelSponte {
  responsavelId: string;
  nome: string;
  dataNascimento: string;
  parentesco: string;
  cep: string;
  endereco: string;
  numeroEndereco: string;
  complementoEndereco: string;
  rg: string;
  cpfCnpj: string;
  cidade: string;
  bairro: string;
  email: string;
  telefone: string;
  celular: string;
  alunoId: string;
  // Lidos do cadastro (comparação com ResponsavelFinanceiroID/DidaticoID do
  // aluno), jamais decididos por esta camada.
  responsavelFinanceiro: boolean;
  responsavelDidatico: boolean;
  observacao: string;
  sexo: string;
  profissao: string;
  tipoPessoa: string;
}

// Campos que o portal de rematrícula pode editar. Qualquer outro campo é
// somente leitura: entra no payload com o valor lido e sai igual.
//
// `telefone` (Fone Residencial no Sponte) NÃO está aqui de propósito: o telefone
// informado no portal é sempre celular e grava só em `celular`.
export const CAMPOS_EDITAVEIS_ALUNO = [
  "cep",
  "endereco",
  "numeroEndereco",
  "complementoEndereco",
  "bairro",
  "cidade",
  "celular",
  "email",
] as const;

export type CampoEditavelAluno = (typeof CAMPOS_EDITAVEIS_ALUNO)[number];

export const CAMPOS_EDITAVEIS_RESPONSAVEL = CAMPOS_EDITAVEIS_ALUNO;

export type CampoEditavelResponsavel = CampoEditavelAluno;

export type EdicaoCadastral = Partial<Record<CampoEditavelAluno, string>>;

// Aplica a edição sobre a ficha lida. Valor em branco é DESCARTADO: o portal
// nunca apaga um dado que já existe no Sponte — quem quiser limpar um campo
// precisa pedir para a secretaria.
export function aplicarEdicao<T extends object>(
  ficha: T,
  edicao: EdicaoCadastral,
  campos: readonly string[],
): T {
  const atualizada: T = { ...ficha };
  for (const campo of campos) {
    const valor = edicao[campo as CampoEditavelAluno];
    if (typeof valor !== "string") continue;
    const limpo = valor.trim();
    if (!limpo) continue;
    (atualizada as Record<string, unknown>)[campo] = limpo;
  }
  return atualizada;
}

// O Sponte devolve campos de lista (CursoInteresse) serializados com ";" e
// ACRESCENTA um separador a cada escrita — foi assim que um campo vazio virou
// ";" e depois ";;" na homologação. Normalizar na leitura e no payload mantém
// apenas os itens reais, então o valor não cresce a cada sincronização.
export function normalizarListaSponte(valor: string): string {
  return (valor ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(";");
}

export interface CampoAlterado {
  campo: string;
  de: string;
  para: string;
}

// Diferença entre a ficha lida e a que será enviada — alimenta a auditoria
// (campo, valor antes, valor depois) e a conferência pós-escrita.
export function camposAlterados<T extends object>(antes: T, depois: T): CampoAlterado[] {
  const de0 = antes as Record<string, unknown>;
  const para0 = depois as Record<string, unknown>;
  const alterados: CampoAlterado[] = [];
  for (const campo of Object.keys(de0)) {
    const de = String(de0[campo] ?? "");
    const para = String(para0[campo] ?? "");
    if (de !== para) alterados.push({ campo, de, para });
  }
  return alterados;
}

export interface DivergenciaCampo {
  campo: string;
  esperado: string;
  encontrado: string;
}

// Confere, na releitura, que TODO campo fora da lista de editados voltou igual
// ao que estava antes da escrita. Qualquer item devolvido aqui significa que o
// Sponte sobrescreveu algo que não foi pedido — a sincronização automática não
// pode ser liberada nesse caso.
export function divergenciasForaDaEdicao<T extends object>(
  antes: T,
  depois: T,
  editados: readonly string[],
): DivergenciaCampo[] {
  const antes0 = antes as Record<string, unknown>;
  const depois0 = depois as Record<string, unknown>;
  const ignorar = new Set(editados);
  const divergencias: DivergenciaCampo[] = [];
  for (const campo of Object.keys(antes0)) {
    if (ignorar.has(campo)) continue;
    const esperado = String(antes0[campo] ?? "");
    const encontrado = String(depois0[campo] ?? "");
    if (esperado !== encontrado) divergencias.push({ campo, esperado, encontrado });
  }
  return divergencias;
}

// ─── Payloads SOAP ──────────────────────────────────────────────────────────

// Data no formato aceito pela escrita do Sponte. Data ilegível vai vazia (o
// campo não é editável pelo portal e o Sponte rejeita formato inválido).
export function dataParaSponte(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd}T00:00:00` : "";
}

function tag(nome: string, valor: string): string {
  return `<${nome}>${escapeXml(valor ?? "")}</${nome}>`;
}

// Payload COMPLETO de UpdateAlunos3: todos os campos da ficha, com os valores já
// lidos do Sponte. Os IDs de responsável são repassados como vieram.
export function montarParametrosUpdateAlunos3(f: FichaAlunoSponte): string {
  return (
    `<nAlunoID>${escapeXml(f.alunoId)}</nAlunoID>` +
    tag("sNome", f.nome) +
    tag("sMidia", f.midia) +
    tag("dDataNascimento", dataParaSponte(f.dataNascimento)) +
    tag("sCidade", f.cidade) +
    tag("sBairro", f.bairro) +
    tag("sCEP", f.cep) +
    tag("sEndereco", f.endereco) +
    tag("nNumeroEndereco", f.numeroEndereco) +
    tag("sComplementoEndereco", f.complementoEndereco) +
    tag("sCPF", f.cpf) +
    tag("sRG", f.rg) +
    tag("nResponsavelFinanceiroID", f.responsavelFinanceiroId) +
    tag("nResponsavelDidaticoID", f.responsavelDidaticoId) +
    tag("sEmail", f.email) +
    tag("sTelefone", f.telefone) +
    tag("sCelular", f.celular) +
    tag("sObservacao", f.observacao) +
    tag("sSexo", f.sexo) +
    tag("sProfissao", f.profissao) +
    tag("sCidadeNatal", f.cidadeNatal) +
    tag("sRa", f.ra) +
    tag("sNumeroMatricula", f.numeroMatricula) +
    tag("sSituacao", f.situacao) +
    tag("sCursoInteresse", normalizarListaSponte(f.cursoInteresse)) +
    tag("sInfoBloqueada", f.infoBloqueada) +
    tag("sOrigemNome", f.origemNome) +
    tag("nOrigemID", f.origemId)
  );
}

// Payload COMPLETO de UpdateResponsaveis2. lResponsavelFinanceiro e
// lResponsavelDidatico saem do que foi LIDO, nunca de uma decisão nossa.
export function montarParametrosUpdateResponsaveis2(f: FichaResponsavelSponte): string {
  return (
    `<nResponsavelID>${escapeXml(f.responsavelId)}</nResponsavelID>` +
    tag("sNome", f.nome) +
    tag("dDataNascimento", dataParaSponte(f.dataNascimento)) +
    tag("nParentesco", f.parentesco) +
    tag("sCEP", f.cep) +
    tag("sEndereco", f.endereco) +
    tag("nNumeroEndereco", f.numeroEndereco) +
    tag("sRG", f.rg) +
    tag("sCPFCNPJ", f.cpfCnpj) +
    tag("sCidade", f.cidade) +
    tag("sBairro", f.bairro) +
    tag("sEmail", f.email) +
    tag("sTelefone", f.telefone) +
    tag("sCelular", f.celular) +
    tag("nAlunoID", f.alunoId) +
    tag("lResponsavelFinanceiro", f.responsavelFinanceiro ? "1" : "0") +
    tag("lResponsavelDidatico", f.responsavelDidatico ? "1" : "0") +
    tag("sObservacao", f.observacao) +
    tag("sSexo", f.sexo) +
    tag("sProfissao", f.profissao) +
    tag("nTipoPessoa", f.tipoPessoa) +
    tag("sComplementoEndereco", f.complementoEndereco)
  );
}

// Nenhum campo com conteúdo na leitura pode ir vazio no payload: é essa a
// checagem que impede a escrita de apagar dado do Sponte por omissão.
export function camposEsvaziados<T extends object>(lida: T, aEnviar: T): string[] {
  const lida0 = lida as Record<string, unknown>;
  const enviar0 = aEnviar as Record<string, unknown>;
  return Object.keys(lida0).filter(
    (campo) =>
      String(lida0[campo] ?? "").trim() !== "" && String(enviar0[campo] ?? "").trim() === "",
  );
}
