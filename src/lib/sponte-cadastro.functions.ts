// Leitura e escrita da ficha cadastral no Sponte (GetAlunos/GetResponsaveis +
// UpdateAlunos3/UpdateResponsaveis2).
//
// A escrita SEMPRE parte de uma leitura completa da ficha: o Sponte grava o
// envelope inteiro, então um campo omitido pode apagar o dado que estava lá. As
// regras puras (payload completo, campos editáveis, conferência) estão em
// ./sponte-cadastro; aqui fica só o transporte.

import {
  callSponte,
  callSponteMethod,
  checkFault,
  paraYMD,
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
} from "./sponte.functions";
import {
  montarParametrosUpdateAlunos3,
  montarParametrosUpdateResponsaveis2,
  normalizarListaSponte,
  type FichaAlunoSponte,
  type FichaResponsavelSponte,
} from "./sponte-cadastro";

export interface LeituraFichaAluno {
  ficha: FichaAlunoSponte | null;
  turma: string;
  error?: string;
  indisponivel?: boolean;
}

export async function lerFichaAlunoSponte(
  unidade: string,
  alunoId: string,
): Promise<LeituraFichaAluno> {
  const creds = resolverCredenciais(unidade);
  if (!creds) return { ficha: null, turma: "", indisponivel: true };

  let xml: string;
  try {
    xml = await callSponte("GetAlunos", `AlunoID=${alunoId}`, creds.codigoCliente, creds.token);
  } catch (e) {
    return {
      ficha: null,
      turma: "",
      error: e instanceof Error ? e.message : "Falha ao consultar o Sponte.",
    };
  }
  const fault = checkFault(xml);
  if (fault) return { ficha: null, turma: "", error: fault };

  const node = parseXmlList(xml, "wsAluno").find((n) =>
    parseXmlValue(n, "RetornoOperacao").startsWith("01"),
  );
  if (!node) return { ficha: null, turma: "", error: "Aluno não encontrado no Sponte." };

  const ficha: FichaAlunoSponte = {
    alunoId: parseXmlValue(node, "AlunoID") || alunoId,
    nome: parseXmlValue(node, "Nome"),
    midia: parseXmlValue(node, "Midia"),
    dataNascimento: paraYMD(parseXmlValue(node, "DataNascimento")) ?? "",
    cidade: parseXmlValue(node, "Cidade"),
    bairro: parseXmlValue(node, "Bairro"),
    cep: parseXmlValue(node, "CEP"),
    endereco: parseXmlValue(node, "Endereco"),
    numeroEndereco: parseXmlValue(node, "NumeroEndereco"),
    complementoEndereco: parseXmlValue(node, "ComplementoEndereco"),
    cpf: parseXmlValue(node, "CPF"),
    rg: parseXmlValue(node, "RG"),
    responsavelFinanceiroId: parseXmlValue(node, "ResponsavelFinanceiroID"),
    responsavelDidaticoId: parseXmlValue(node, "ResponsavelDidaticoID"),
    email: parseXmlValue(node, "Email"),
    telefone: parseXmlValue(node, "Telefone"),
    celular: parseXmlValue(node, "Celular"),
    observacao: parseXmlValue(node, "Observacao"),
    sexo: parseXmlValue(node, "Sexo"),
    // O GetAlunos não devolve Profissao do aluno; o campo existe na escrita e
    // segue vazio (nunca é o portal que preenche profissão de aluno).
    profissao: "",
    cidadeNatal: parseXmlValue(node, "CidadeNatal"),
    ra: parseXmlValue(node, "RA"),
    numeroMatricula: parseXmlValue(node, "NumeroMatricula"),
    situacao: parseXmlValue(node, "Situacao"),
    // Campo de lista: normalizado já na leitura para que o ";" que o Sponte
    // acrescenta a cada escrita não entre na comparação nem cresça no payload.
    cursoInteresse: normalizarListaSponte(parseXmlValue(node, "CursoInteresse")),
    infoBloqueada: parseXmlValue(node, "InfoBloqueada"),
    origemNome: parseXmlValue(node, "NomeOrigem"),
    origemId: parseXmlValue(node, "Origem"),
  };

  return { ficha, turma: parseXmlValue(node, "TurmaAtual") };
}

export interface LeituraFichaResponsavel {
  ficha: FichaResponsavelSponte | null;
  error?: string;
  indisponivel?: boolean;
}

// Ficha do responsável no contexto de UM aluno: o parentesco e os papéis
// (financeiro/didático) só existem nesse vínculo, e é isso que a escrita exige.
// Os papéis vêm da COMPARAÇÃO com os IDs lidos na ficha do aluno — nunca de uma
// decisão desta camada.
export async function lerFichaResponsavelSponte(
  unidade: string,
  alunoId: string,
  responsavelId: string,
  responsavelFinanceiroId: string,
  responsavelDidaticoId: string,
): Promise<LeituraFichaResponsavel> {
  const creds = resolverCredenciais(unidade);
  if (!creds) return { ficha: null, indisponivel: true };

  let xml: string;
  try {
    xml = await callSponte(
      "GetResponsaveis",
      `AlunoID=${alunoId}`,
      creds.codigoCliente,
      creds.token,
    );
  } catch (e) {
    return { ficha: null, error: e instanceof Error ? e.message : "Falha ao consultar o Sponte." };
  }
  const fault = checkFault(xml);
  if (fault) return { ficha: null, error: fault };

  const node = parseXmlList(xml, "wsResponsavel").find(
    (n) =>
      parseXmlValue(n, "RetornoOperacao").startsWith("01") &&
      parseXmlValue(n, "ResponsavelID") === responsavelId,
  );
  if (!node) return { ficha: null, error: "Responsável não encontrado no Sponte." };

  // Parentesco fica no vínculo aluno↔responsável (wsAlunos dentro do nó).
  const vinculo = parseXmlList(node, "wsAlunos").find(
    (a) => parseXmlValue(a, "AlunoID") === alunoId,
  );

  const ficha: FichaResponsavelSponte = {
    responsavelId,
    nome: parseXmlValue(node, "Nome"),
    dataNascimento: paraYMD(parseXmlValue(node, "DataNascimento")) ?? "",
    parentesco: vinculo ? parseXmlValue(vinculo, "Parentesco") : parseXmlValue(node, "Parentesco"),
    cep: parseXmlValue(node, "CEP"),
    endereco: parseXmlValue(node, "Endereco"),
    numeroEndereco: parseXmlValue(node, "NumeroEndereco"),
    complementoEndereco: parseXmlValue(node, "ComplementoEndereco"),
    rg: parseXmlValue(node, "RG"),
    cpfCnpj: parseXmlValue(node, "CPFCNPJ") || parseXmlValue(node, "CPF"),
    cidade: parseXmlValue(node, "Cidade"),
    bairro: parseXmlValue(node, "Bairro"),
    email: parseXmlValue(node, "Email"),
    telefone: parseXmlValue(node, "Telefone"),
    celular: parseXmlValue(node, "Celular"),
    alunoId,
    responsavelFinanceiro: !!responsavelId && responsavelId === responsavelFinanceiroId,
    responsavelDidatico: !!responsavelId && responsavelId === responsavelDidaticoId,
    observacao: parseXmlValue(node, "Observacao"),
    sexo: parseXmlValue(node, "Sexo"),
    // Não devolvido pelo GetResponsaveis (ver Fase A: o teste mede se a omissão
    // apaga o dado no Sponte).
    profissao: "",
    tipoPessoa: parseXmlValue(node, "TipoPessoa"),
  };

  return { ficha };
}

export interface EscritaCadastroResult {
  ok: boolean;
  retornoOperacao?: string;
  error?: string;
  indisponivel?: boolean;
}

// "01 - Sucesso" (o Sponte prefixa o código no RetornoOperacao).
function escritaConfirmada(retornoOperacao: string): boolean {
  return retornoOperacao.trim().startsWith("01");
}

async function escrever(
  unidade: string,
  method: "UpdateAlunos3" | "UpdateResponsaveis2",
  extraParams: string,
): Promise<EscritaCadastroResult> {
  const creds = resolverCredenciais(unidade);
  if (!creds) return { ok: false, indisponivel: true };

  let xml: string;
  try {
    xml = await callSponteMethod(method, extraParams, creds.codigoCliente, creds.token);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao escrever no Sponte." };
  }
  const fault = checkFault(xml);
  if (fault) return { ok: false, error: fault };

  const retornoOperacao = parseXmlValue(xml, "RetornoOperacao");
  if (!escritaConfirmada(retornoOperacao)) {
    return {
      ok: false,
      retornoOperacao,
      error: retornoOperacao || "O Sponte não confirmou a atualização cadastral.",
    };
  }
  return { ok: true, retornoOperacao };
}

export function atualizarFichaAlunoSponte(
  unidade: string,
  ficha: FichaAlunoSponte,
): Promise<EscritaCadastroResult> {
  return escrever(unidade, "UpdateAlunos3", montarParametrosUpdateAlunos3(ficha));
}

export function atualizarFichaResponsavelSponte(
  unidade: string,
  ficha: FichaResponsavelSponte,
): Promise<EscritaCadastroResult> {
  return escrever(unidade, "UpdateResponsaveis2", montarParametrosUpdateResponsaveis2(ficha));
}
