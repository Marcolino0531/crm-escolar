// Motor da matrícula automática: recebe o payload do formulário (Google Forms)
// e cria o cadastro no Sponte em duas etapas ENCADEADAS — primeiro o Aluno
// (dados pessoais + endereço), depois cada Responsável já atrelado ao AlunoID
// devolvido pelo passo anterior.
//
// Métodos usados (WSAPIEdu):
//   InsertAlunos3       — versão mais nova; é a única que aceita
//                         sComplementoEndereco. Retorna apenas RetornoOperacao
//                         (DataSet), sem o ID; por isso o AlunoID é resolvido em
//                         seguida por GetAlunos (CPF, ou nome + nascimento).
//   InsertResponsaveis2 — idem, com sComplementoEndereco e nAlunoID.
//
// A API NÃO tem campo de nacionalidade na inserção (só na leitura), então ela é
// registrada na observação do aluno. Naturalidade vai em sCidadeNatal.

import {
  callSponte,
  callSponteMethod,
  checkFault,
  escapeXml,
  parseXmlValue,
  resolverCredenciais,
} from "@/lib/sponte.functions";

// Parentesco é um inteiro NEGATIVO no Sponte (mesmo padrão de SituacaoAlunoID e
// das formas de cobrança). A API não expõe a tabela; os códigos abaixo foram
// levantados contra a base do CEC — só existem três, e qualquer outro valor
// devolve "31 - Parentesco inválido":
//   -1 Pai   -2 Mãe   -3 Responsável
// Podem ser sobrescritos por SPONTE_PARENTESCO_MAP (JSON) — útil se outra
// unidade tiver uma tabela diferente — ou, caso a caso, pelo campo
// `parentescoId` do payload.
const PARENTESCO_GENERICO = -3;

const PARENTESCO_PADRAO: Record<string, number> = {
  pai: -1,
  mae: -2,
  responsavel: PARENTESCO_GENERICO,
};

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function mapaParentesco(): Record<string, number> {
  const raw = process.env.SPONTE_PARENTESCO_MAP;
  if (!raw) return PARENTESCO_PADRAO;
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    const extra: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isInteger(v)) extra[normalizar(k)] = v;
    }
    return { ...PARENTESCO_PADRAO, ...extra };
  } catch {
    console.warn("[matrículas] SPONTE_PARENTESCO_MAP não é um JSON válido — usando o padrão.");
    return PARENTESCO_PADRAO;
  }
}

// Regra do colégio: a mãe é SEMPRE responsável didática, independentemente do que
// o formulário marcar. O responsável financeiro continua sendo escolha do
// formulário. Garantido aqui (e não só no Apps Script) para valer para qualquer
// origem que chame o webhook.
export function ehMae(parentesco: string): boolean {
  return normalizar(parentesco).startsWith("mae");
}

// Avó, tio, padrasto, guardião… nada disso existe na tabela do Sponte, então cai
// em "Responsável" em vez de derrubar a matrícula por um parentesco atípico.
export function codigoParentesco(rotulo: string): number {
  const mapa = mapaParentesco();
  const chave = normalizar(rotulo);
  if (chave in mapa) return mapa[chave];
  // "Mãe biológica", "Pai (adotivo)" etc. — casa pelo prefixo mais específico.
  const parcial = Object.keys(mapa)
    .filter((k) => chave.startsWith(k) || chave.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return parcial ? mapa[parcial] : PARENTESCO_GENERICO;
}

// Aceita "YYYY-MM-DD", "DD/MM/YYYY" e "DD/MM/YYYY HH:mm". Devolve o formato
// dateTime que o Sponte espera, sem criar Date (a Vercel roda em UTC e um
// new Date("2019-03-14") deslocaria o dia).
export function paraDateTimeSponte(valor: string): string | null {
  const s = valor.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (br) {
    const [, d, m, y] = br;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00`;
  }
  return null;
}

function soDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

export interface EnderecoResolvido {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
}

interface ViaCepResposta {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  erro?: boolean | string;
}

// O formulário coleta CEP + número + complemento; logradouro/bairro/cidade são
// completados pelo ViaCEP quando não vierem no payload. Falha de consulta não
// derruba a matrícula — o Sponte aceita o endereço parcial.
export async function resolverEndereco(entrada: {
  cep: string;
  numero: string;
  complemento?: string;
  logradouro?: string;
  bairro?: string;
  cidade?: string;
}): Promise<EnderecoResolvido> {
  const base: EnderecoResolvido = {
    cep: entrada.cep.trim(),
    logradouro: entrada.logradouro?.trim() ?? "",
    numero: entrada.numero.trim(),
    complemento: entrada.complemento?.trim() ?? "",
    bairro: entrada.bairro?.trim() ?? "",
    cidade: entrada.cidade?.trim() ?? "",
  };

  const cepDigitos = soDigitos(base.cep);
  if (cepDigitos.length !== 8) return base;
  if (base.logradouro && base.bairro && base.cidade) return base;

  try {
    const resposta = await fetch(`https://viacep.com.br/ws/${cepDigitos}/json/`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resposta.ok) return base;
    const dados = (await resposta.json()) as ViaCepResposta;
    if (dados.erro) return base;
    return {
      ...base,
      logradouro: base.logradouro || (dados.logradouro ?? ""),
      bairro: base.bairro || (dados.bairro ?? ""),
      cidade: base.cidade || (dados.localidade ?? ""),
    };
  } catch {
    return base;
  }
}

export interface AlunoMatricula {
  nome: string;
  dataNascimento: string;
  cpf?: string;
  rg?: string;
  sexo?: string;
  naturalidade?: string;
  nacionalidade?: string;
  email?: string;
  telefone?: string;
  celular?: string;
  observacao?: string;
  situacao?: string;
  midia?: string;
}

export interface ResponsavelMatricula {
  nome: string;
  parentesco: string;
  parentescoId?: number;
  dataNascimento?: string;
  cpf?: string;
  rg?: string;
  sexo?: string;
  profissao?: string;
  email?: string;
  telefone?: string;
  celular?: string;
  responsavelFinanceiro?: boolean;
  responsavelDidatico?: boolean;
  endereco?: {
    cep: string;
    numero: string;
    complemento?: string;
    logradouro?: string;
    bairro?: string;
    cidade?: string;
  };
}

export interface MatriculaPayload {
  submissionId?: string;
  unidade: string;
  // Reprocessamento: com o AlunoID preenchido, o aluno NÃO é criado de novo e o
  // fluxo vai direto para os responsáveis. É a saída para quando o aluno entrou
  // mas um responsável falhou.
  alunoIdExistente?: number;
  aluno: AlunoMatricula;
  endereco: {
    cep: string;
    numero: string;
    complemento?: string;
    logradouro?: string;
    bairro?: string;
    cidade?: string;
  };
  responsaveis: ResponsavelMatricula[];
}

export interface ResponsavelResultado {
  nome: string;
  parentesco: string;
  parentescoId: number;
  responsavelFinanceiro: boolean;
  responsavelDidatico: boolean;
  ok: boolean;
  retorno: string;
  responsavelId: number | null;
  // Rótulo que o Sponte devolveu ao reler o responsável — confirma se o código
  // numérico enviado corresponde ao parentesco pedido no formulário.
  parentescoConfirmado: string | null;
}

export type MatriculaStatus =
  | "sucesso"
  | "duplicado"
  | "erro_aluno"
  | "erro_responsavel"
  | "dry_run";

export interface MatriculaResultado {
  ok: boolean;
  status: MatriculaStatus;
  alunoId: number | null;
  alunoJaExistia: boolean;
  endereco: EnderecoResolvido;
  responsaveis: ResponsavelResultado[];
  error?: string;
}

// "01 - Operação Realizada com Sucesso." → sucesso; "43 - ..." → erro.
function retornoOk(retorno: string): boolean {
  return normalizar(retorno).includes("sucesso");
}

async function buscarAlunoPorCpf(
  cpf: string,
  codigoCliente: string,
  token: string,
): Promise<number | null> {
  const digitos = soDigitos(cpf);
  if (digitos.length !== 11) return null;
  const formatado = `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
  for (const variacao of [digitos, formatado]) {
    const xml = await callSponte("GetAlunos", `CPF=${variacao}`, codigoCliente, token);
    if (checkFault(xml)) continue;
    const id = parseInt(parseXmlValue(xml, "AlunoID"), 10);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

// Sem CPF, o aluno recém-criado é localizado pelo nome exato + nascimento; entre
// homônimos vale o maior AlunoID (o último criado).
async function buscarAlunoPorNome(
  nome: string,
  nascimentoISO: string,
  codigoCliente: string,
  token: string,
): Promise<number | null> {
  const xml = await callSponte("GetAlunos", `Nome=${nome}`, codigoCliente, token);
  if (checkFault(xml)) return null;

  const [ano, mes, dia] = nascimentoISO.slice(0, 10).split("-");
  const nascimentoBr = `${dia}/${mes}/${ano}`;
  const alvo = normalizar(nome);

  let melhor: number | null = null;
  for (const bloco of xml.match(/<wsAluno>[\s\S]*?<\/wsAluno>/g) ?? []) {
    if (normalizar(parseXmlValue(bloco, "Nome")) !== alvo) continue;
    if (!parseXmlValue(bloco, "DataNascimento").startsWith(nascimentoBr)) continue;
    const id = parseInt(parseXmlValue(bloco, "AlunoID"), 10);
    if (Number.isFinite(id) && id > 0 && (melhor === null || id > melhor)) melhor = id;
  }
  return melhor;
}

// Relê o responsável recém-criado para (a) capturar o ResponsavelID e (b)
// registrar o rótulo de parentesco que o Sponte gravou.
async function conferirResponsavel(
  alunoId: number,
  nome: string,
  codigoCliente: string,
  token: string,
): Promise<{ responsavelId: number | null; parentesco: string | null }> {
  const xml = await callSponte("GetResponsaveis", `AlunoID=${alunoId}`, codigoCliente, token);
  if (checkFault(xml)) return { responsavelId: null, parentesco: null };

  const alvo = normalizar(nome);
  for (const bloco of xml.match(/<wsResponsavel>[\s\S]*?<\/wsResponsavel>/g) ?? []) {
    if (normalizar(parseXmlValue(bloco, "Nome")) !== alvo) continue;
    const id = parseInt(parseXmlValue(bloco, "ResponsavelID"), 10);
    return {
      responsavelId: Number.isFinite(id) && id > 0 ? id : null,
      parentesco: parseXmlValue(bloco, "Parentesco") || null,
    };
  }
  return { responsavelId: null, parentesco: null };
}

function observacaoAluno(aluno: AlunoMatricula): string {
  const partes = [aluno.observacao?.trim() ?? ""];
  // A inserção do Sponte não tem campo de nacionalidade (só a leitura tem).
  if (aluno.nacionalidade?.trim()) partes.push(`Nacionalidade: ${aluno.nacionalidade.trim()}`);
  partes.push("Matrícula criada pelo formulário de matrícula (School Hub).");
  return partes.filter(Boolean).join(" | ");
}

function camposAluno(aluno: AlunoMatricula, endereco: EnderecoResolvido, nascimento: string) {
  return {
    sNome: aluno.nome.trim(),
    sMidia: aluno.midia?.trim() ?? "",
    dDataNascimento: nascimento,
    sCidade: endereco.cidade,
    sBairro: endereco.bairro,
    sCEP: endereco.cep,
    sEndereco: endereco.logradouro,
    nNumeroEndereco: endereco.numero,
    sComplementoEndereco: endereco.complemento,
    sEmail: aluno.email?.trim() ?? "",
    sTelefone: aluno.telefone?.trim() ?? "",
    sCPF: aluno.cpf?.trim() ?? "",
    sRG: aluno.rg?.trim() ?? "",
    sCelular: aluno.celular?.trim() ?? "",
    sObservacao: observacaoAluno(aluno),
    sSexo: aluno.sexo?.trim() ?? "",
    sProfissao: "",
    sCidadeNatal: aluno.naturalidade?.trim() ?? "",
    sRa: "",
    sNumeroMatricula: "",
    sSituacao: aluno.situacao?.trim() || "Ativo",
    sCursoInteresse: "",
    sInfoBloqueada: "",
    sOrigemNome: "",
    nOrigemID: "",
  };
}

function camposResponsavel(
  resp: ResponsavelMatricula,
  parentescoId: number,
  didatico: boolean,
  endereco: EnderecoResolvido,
  nascimento: string,
  alunoId: number,
) {
  return {
    sNome: resp.nome.trim(),
    dDataNascimento: nascimento,
    nParentesco: String(parentescoId),
    sCEP: endereco.cep,
    sEndereco: endereco.logradouro,
    nNumeroEndereco: endereco.numero,
    sRG: resp.rg?.trim() ?? "",
    sCPFCNPJ: resp.cpf?.trim() ?? "",
    sCidade: endereco.cidade,
    sBairro: endereco.bairro,
    sEmail: resp.email?.trim() ?? "",
    sTelefone: resp.telefone?.trim() ?? "",
    sCelular: resp.celular?.trim() ?? "",
    nAlunoID: String(alunoId),
    lResponsavelFinanceiro: resp.responsavelFinanceiro ? "true" : "false",
    lResponsavelDidatico: didatico ? "true" : "false",
    sObservacao: "",
    sSexo: resp.sexo?.trim() ?? "",
    sProfissao: resp.profissao?.trim() ?? "",
    nTipoPessoa: "1", // 1 = pessoa física
    sComplementoEndereco: endereco.complemento,
  };
}

// Serializa na ORDEM do WSDL — o Sponte rejeita parâmetros fora de ordem.
function serializar(campos: Record<string, string>): string {
  return Object.entries(campos)
    .map(([tag, valor]) => `<${tag}>${escapeXml(valor)}</${tag}>`)
    .join("");
}

export class MatriculaError extends Error {
  // 422 para o que o formulário pode corrigir (data, parentesco, unidade);
  // 502 para o que veio do Sponte.
  constructor(
    readonly status: MatriculaStatus,
    message: string,
    readonly httpStatus: 422 | 502 = 502,
  ) {
    super(message);
    this.name = "MatriculaError";
  }
}

export async function processarMatricula(
  payload: MatriculaPayload,
  opcoes: { dryRun: boolean },
): Promise<MatriculaResultado> {
  const creds = resolverCredenciais(payload.unidade);
  if (!creds) {
    throw new MatriculaError(
      "erro_aluno",
      `Unidade "${payload.unidade}" não tem integração Sponte configurada.`,
      422,
    );
  }

  const nascimentoAluno = paraDateTimeSponte(payload.aluno.dataNascimento);
  if (!nascimentoAluno) {
    throw new MatriculaError(
      "erro_aluno",
      `Data de nascimento do aluno inválida: "${payload.aluno.dataNascimento}". Use AAAA-MM-DD ou DD/MM/AAAA.`,
      422,
    );
  }

  const endereco = await resolverEndereco(payload.endereco);

  // O Sponte aceita no máximo um Pai e uma Mãe por aluno ("O aluno pode ter
  // apenas um pai e uma mãe cadastrados"). Um segundo com o mesmo papel entra
  // como "Responsável" em vez de derrubar o cadastro.
  const usados = new Set<number>();
  const parentescos = payload.responsaveis.map((r) => {
    if (r.parentescoId !== undefined) return r.parentescoId;
    const codigo = codigoParentesco(r.parentesco);
    if ((codigo === -1 || codigo === -2) && usados.has(codigo)) return PARENTESCO_GENERICO;
    usados.add(codigo);
    return codigo;
  });

  const nascimentosResponsaveis = payload.responsaveis.map((r) => {
    if (!r.dataNascimento?.trim()) return "1900-01-01T00:00:00";
    const d = paraDateTimeSponte(r.dataNascimento);
    if (!d) {
      throw new MatriculaError(
        "erro_responsavel",
        `Data de nascimento inválida para o responsável "${r.nome}": "${r.dataNascimento}".`,
        422,
      );
    }
    return d;
  });

  // Trava anti-duplicidade: reenvio do mesmo formulário não cria um segundo
  // cadastro. O CPF do aluno é a chave (quando informado).
  const cpfAluno = payload.aluno.cpf?.trim();
  if (cpfAluno && !payload.alunoIdExistente) {
    const existente = await buscarAlunoPorCpf(cpfAluno, creds.codigoCliente, creds.token);
    if (existente) {
      return {
        ok: false,
        status: "duplicado",
        alunoId: existente,
        alunoJaExistia: true,
        endereco,
        responsaveis: [],
        error: `Já existe um aluno no Sponte com o CPF informado (AlunoID ${existente}). Nada foi criado.`,
      };
    }
  }

  if (opcoes.dryRun) {
    return {
      ok: true,
      status: "dry_run",
      alunoId: null,
      alunoJaExistia: false,
      endereco,
      responsaveis: payload.responsaveis.map((r, i) => ({
        nome: r.nome,
        parentesco: r.parentesco,
        parentescoId: parentescos[i],
        responsavelFinanceiro: r.responsavelFinanceiro === true,
        responsavelDidatico: r.responsavelDidatico === true || ehMae(r.parentesco),
        ok: true,
        retorno: "dry run — nada foi enviado ao Sponte",
        responsavelId: null,
        parentescoConfirmado: null,
      })),
    };
  }

  const alunoId = payload.alunoIdExistente
    ? payload.alunoIdExistente
    : await criarAluno(payload, endereco, nascimentoAluno, creds.codigoCliente, creds.token);

  // ── Passo 3: Responsáveis, um a um, atrelados ao AlunoID ───────────────────
  const responsaveis: ResponsavelResultado[] = [];
  for (const [i, resp] of payload.responsaveis.entries()) {
    // Sem bloco `endereco` próprio, o responsável espelha o endereço do aluno.
    const enderecoResp = resp.endereco ? await resolverEndereco(resp.endereco) : endereco;
    const didatico = resp.responsavelDidatico === true || ehMae(resp.parentesco);
    const xml = await callSponteMethod(
      "InsertResponsaveis2",
      serializar(
        camposResponsavel(
          resp,
          parentescos[i],
          didatico,
          enderecoResp,
          nascimentosResponsaveis[i],
          alunoId,
        ),
      ),
      creds.codigoCliente,
      creds.token,
    );

    const faultResp = checkFault(xml);
    const retorno = faultResp ?? parseXmlValue(xml, "RetornoOperacao");
    // A releitura roda mesmo quando o Sponte devolve erro: já observamos o
    // responsável ser criado junto com um "29 - CPF já associado". Sem conferir,
    // um reenvio duplicaria o cadastro.
    const conferido = await conferirResponsavel(
      alunoId,
      resp.nome,
      creds.codigoCliente,
      creds.token,
    );
    const ok = (!faultResp && retornoOk(retorno)) || conferido.responsavelId !== null;

    responsaveis.push({
      nome: resp.nome,
      parentesco: resp.parentesco,
      parentescoId: parentescos[i],
      responsavelFinanceiro: resp.responsavelFinanceiro === true,
      responsavelDidatico: didatico,
      ok,
      retorno: retorno || "O Sponte não devolveu retorno.",
      responsavelId: conferido.responsavelId,
      parentescoConfirmado: conferido.parentesco,
    });
  }

  const falhas = responsaveis.filter((r) => !r.ok);
  return {
    ok: falhas.length === 0,
    status: falhas.length === 0 ? "sucesso" : "erro_responsavel",
    alunoId,
    alunoJaExistia: !!payload.alunoIdExistente,
    endereco,
    responsaveis,
    error:
      falhas.length === 0
        ? undefined
        : `Aluno ${payload.alunoIdExistente ? "" : "criado "}(AlunoID ${alunoId}), mas ${falhas.length} responsável(is) falharam: ${falhas
            .map((f) => `${f.nome} — ${f.retorno}`)
            .join("; ")}`,
  };
}

// Passos 1 e 2 do fluxo: cria o aluno e devolve o AlunoID gerado.
async function criarAluno(
  payload: MatriculaPayload,
  endereco: EnderecoResolvido,
  nascimentoAluno: string,
  codigoCliente: string,
  token: string,
): Promise<number> {
  const xmlAluno = await callSponteMethod(
    "InsertAlunos3",
    serializar(camposAluno(payload.aluno, endereco, nascimentoAluno)),
    codigoCliente,
    token,
  );

  const fault = checkFault(xmlAluno);
  if (fault) throw new MatriculaError("erro_aluno", fault);

  const retornoAluno = parseXmlValue(xmlAluno, "RetornoOperacao");
  if (!retornoOk(retornoAluno)) {
    throw new MatriculaError("erro_aluno", retornoAluno || "O Sponte não confirmou a criação.");
  }

  // O InsertAlunos3 devolve só o texto da operação — o ID vem de uma releitura.
  const cpf = payload.aluno.cpf?.trim();
  const alunoId =
    (cpf ? await buscarAlunoPorCpf(cpf, codigoCliente, token) : null) ??
    (await buscarAlunoPorNome(payload.aluno.nome, nascimentoAluno, codigoCliente, token));

  if (!alunoId) {
    throw new MatriculaError(
      "erro_aluno",
      "O aluno foi criado no Sponte, mas o AlunoID não pôde ser localizado — os responsáveis não foram enviados.",
    );
  }
  return alunoId;
}
