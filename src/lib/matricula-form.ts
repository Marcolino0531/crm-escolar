// Regras puras do formulário público de matrícula (/matricula).
//
// Ficam isoladas de React e de rede porque são a barreira que evita erro de
// digitação chegar ao Sponte: validação de CPF (dígito verificador), campos
// obrigatórios e a montagem do payload no MESMO contrato que o webhook do
// Google Forms usa hoje (MatriculaSchema → processarMatricula).
//
// A página é pública, então há também o limite de submissões por IP: a contagem
// vem do banco e a decisão de recusar é tomada aqui.

import { INDICE_PRIMEIRO_ANO, TURMAS_POR_IDADE, calcularIdadeEscolar } from "@/lib/crm/mecCutoff";
import { MEALS, WEEKDAYS, type MealKey, type Weekday } from "@/lib/diario";
import { type MatriculaPayload, type ResponsavelMatricula } from "@/lib/matriculas.sponte";
import { toTitleCase } from "@/lib/name-format";

export const MAX_SUBMISSOES_POR_IP = 5;
export const JANELA_LIMITE_MINUTOS = 60;

export const ORIGEM_SITE = "site";
export const ORIGEM_GOOGLE_FORMS = "google_forms";

// Mídias do Sponte são um cadastro fechado (GetMidias devolve ID + descrição) e
// a inserção só aceita uma descrição existente: um nome desconhecido faz a API
// tentar converter o ID vazio e falhar com
// `Conversion from string "" to type 'Double' is not valid.`
export const MIDIAS_SPONTE = [
  "Anúncios",
  "Campanhas",
  "Folder",
  "Facebook",
  "Indicação",
  "Internet",
  "WhatsApp",
] as const;

export const MIDIA_MATRICULA_SITE = "Internet";

// Gênero no Sponte é lista fechada e `sSexo` só aceita a descrição por extenso:
// dos 626 alunos do cadastro, 623 têm exatamente "Feminino" ou "Masculino"
// (GetAlunos), e abreviações como "F"/"M" não casam com nenhuma opção.
export const SEXOS_SPONTE = ["Feminino", "Masculino"] as const;

export function soDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

// ─── Máscaras ───────────────────────────────────────────────────────────────

export function formatarCpf(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatarCep(v: string): string {
  const d = soDigitos(v).slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

// ─── Validações ─────────────────────────────────────────────────────────────

// CPF com dígito verificador (o Sponte aceita qualquer sequência de 11 dígitos,
// então a checagem real precisa acontecer antes do envio).
export function cpfCompletoValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const digito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(d[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

export function cepCompletoValido(cep: string): boolean {
  return soDigitos(cep).length === 8;
}

// Aceita apenas o formato do <input type="date"> e recusa data impossível
// (31/02). Não diz nada sobre passado/futuro.
export function dataValida(valor: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (!m) return false;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > ultimoDia) return false;
  return ano >= 1900;
}

// Data de nascimento nunca é no futuro.
export function dataNascimentoValida(valor: string, hojeYMD: string): boolean {
  return dataValida(valor) && valor.trim() <= hojeYMD;
}

export function telefoneValido(v: string): boolean {
  const d = soDigitos(v);
  return d.length === 10 || d.length === 11;
}

export function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

// ─── Formulário ─────────────────────────────────────────────────────────────

export interface EnderecoForm {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
}

export const ENDERECO_VAZIO: EnderecoForm = {
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
};

export interface ResponsavelForm {
  nome: string;
  cpf: string;
  dataNascimento: string;
  telefone: string;
  email: string;
  // Endereço próprio; quando true, o do aluno é replicado no envio.
  mesmoEnderecoDoAluno: boolean;
  endereco: EnderecoForm;
}

export const RESPONSAVEL_VAZIO: ResponsavelForm = {
  nome: "",
  cpf: "",
  dataNascimento: "",
  telefone: "",
  email: "",
  mesmoEnderecoDoAluno: true,
  endereco: ENDERECO_VAZIO,
};

export type ParentescoForm = "pai" | "mae";

export const GENEROS_MATRICULA = SEXOS_SPONTE;

export type GeneroMatricula = (typeof GENEROS_MATRICULA)[number];

export interface MatriculaForm {
  unidade: string;
  aluno: {
    nome: string;
    cpf: string;
    dataNascimento: string;
    genero: GeneroMatricula | "";
    naturalidade: string;
  };
  endereco: EnderecoForm;
  pai: ResponsavelForm;
  mae: ResponsavelForm;
  // Qual dos dois responde financeiramente pela matrícula.
  responsavelFinanceiro: ParentescoForm;
}

export const MATRICULA_FORM_VAZIO: MatriculaForm = {
  unidade: "",
  aluno: { nome: "", cpf: "", dataNascimento: "", genero: "", naturalidade: "" },
  endereco: ENDERECO_VAZIO,
  pai: RESPONSAVEL_VAZIO,
  mae: RESPONSAVEL_VAZIO,
  responsavelFinanceiro: "mae",
};

// Um bloco de responsável totalmente em branco significa "não informado"
// (famílias com um único responsável) — nesse caso ele não é validado nem
// enviado. O Sponte exige pelo menos um responsável com CPF.
export function responsavelPreenchido(r: ResponsavelForm): boolean {
  return [r.nome, r.cpf, r.dataNascimento, r.telefone, r.email].some((v) => v.trim() !== "");
}

export type ErrosForm = Record<string, string>;

const ROTULO: Record<ParentescoForm, string> = { pai: "pai", mae: "mãe" };

function validarEndereco(prefixo: string, e: EnderecoForm, erros: ErrosForm): void {
  if (!cepCompletoValido(e.cep)) erros[`${prefixo}.cep`] = "Informe um CEP com 8 dígitos.";
  if (e.numero.trim() === "") erros[`${prefixo}.numero`] = "Informe o número.";
}

function validarResponsavel(
  qual: ParentescoForm,
  r: ResponsavelForm,
  hojeYMD: string,
  erros: ErrosForm,
): void {
  if (r.nome.trim().length < 3)
    erros[`${qual}.nome`] = `Informe o nome completo do ${ROTULO[qual]}.`;
  if (!cpfCompletoValido(r.cpf)) erros[`${qual}.cpf`] = "CPF inválido — confira os dígitos.";
  if (!dataNascimentoValida(r.dataNascimento, hojeYMD))
    erros[`${qual}.dataNascimento`] = "Informe uma data de nascimento válida.";
  if (!telefoneValido(r.telefone))
    erros[`${qual}.telefone`] = "Informe o telefone com DDD (10 ou 11 dígitos).";
  if (!emailValido(r.email)) erros[`${qual}.email`] = "Informe um e-mail válido.";
  if (!r.mesmoEnderecoDoAluno) validarEndereco(`${qual}.endereco`, r.endereco, erros);
}

/**
 * Valida o formulário inteiro devolvendo mensagens por campo (chaves como
 * "aluno.cpf" e "mae.telefone"), prontas para exibir sob cada input.
 */
export function validarMatriculaForm(
  form: MatriculaForm,
  hojeYMD: string,
  unidadesValidas: readonly string[],
): ErrosForm {
  const erros: ErrosForm = {};

  if (!unidadesValidas.includes(form.unidade)) erros.unidade = "Escolha o colégio.";

  if (form.aluno.nome.trim().length < 3) erros["aluno.nome"] = "Informe o nome completo do aluno.";
  if (form.aluno.cpf.trim() === "") erros["aluno.cpf"] = "Informe o CPF do aluno.";
  else if (!cpfCompletoValido(form.aluno.cpf))
    erros["aluno.cpf"] = "CPF inválido — confira os dígitos.";
  if (!dataNascimentoValida(form.aluno.dataNascimento, hojeYMD))
    erros["aluno.dataNascimento"] = "Informe uma data de nascimento válida.";
  if (form.aluno.genero === "") erros["aluno.genero"] = "Selecione o gênero do aluno.";
  if (form.aluno.naturalidade.trim() === "")
    erros["aluno.naturalidade"] = "Informe a naturalidade (cidade de nascimento).";

  validarEndereco("endereco", form.endereco, erros);

  const temPai = responsavelPreenchido(form.pai);
  const temMae = responsavelPreenchido(form.mae);
  if (!temPai && !temMae) {
    erros.responsaveis = "Informe os dados de ao menos um responsável (pai ou mãe).";
  } else {
    if (temPai) validarResponsavel("pai", form.pai, hojeYMD, erros);
    if (temMae) validarResponsavel("mae", form.mae, hojeYMD, erros);
    // O responsável financeiro escolhido tem de ser um dos informados.
    const financeiroPreenchido = form.responsavelFinanceiro === "pai" ? temPai : temMae;
    if (!financeiroPreenchido)
      erros.responsavelFinanceiro = `Os dados do ${ROTULO[form.responsavelFinanceiro]} não foram informados — escolha o outro responsável financeiro.`;
  }

  return erros;
}

export function formValido(erros: ErrosForm): boolean {
  return Object.keys(erros).length === 0;
}

// ─── Payload ────────────────────────────────────────────────────────────────

function enderecoPayload(e: EnderecoForm) {
  return {
    cep: soDigitos(e.cep),
    numero: e.numero.trim(),
    complemento: e.complemento.trim(),
    logradouro: e.logradouro.trim(),
    bairro: e.bairro.trim(),
    cidade: e.cidade.trim(),
  };
}

function responsavelPayload(
  qual: ParentescoForm,
  r: ResponsavelForm,
  form: MatriculaForm,
): ResponsavelMatricula {
  const financeiro = form.responsavelFinanceiro === qual;
  return {
    nome: r.nome.trim(),
    parentesco: qual === "pai" ? "Pai" : "Mãe",
    dataNascimento: r.dataNascimento.trim(),
    cpf: soDigitos(r.cpf),
    email: r.email.trim(),
    celular: soDigitos(r.telefone),
    responsavelFinanceiro: financeiro,
    // Quem responde financeiramente é também o contato didático padrão — é o
    // mesmo comportamento do formulário atual.
    responsavelDidatico: financeiro,
    endereco: r.mesmoEnderecoDoAluno ? enderecoPayload(form.endereco) : enderecoPayload(r.endereco),
  };
}

/**
 * Converte o formulário da página pública no payload que `processarMatricula`
 * (e o webhook do Google Forms) já consomem — nenhuma regra de Sponte é
 * reimplementada aqui.
 */
export function montarPayloadMatricula(
  form: MatriculaForm,
  submissionId: string,
): MatriculaPayload {
  const responsaveis: ResponsavelMatricula[] = [];
  // O responsável financeiro vai primeiro: é ele que o Sponte usa como contato
  // principal quando há mais de um cadastro.
  const ordem: ParentescoForm[] =
    form.responsavelFinanceiro === "pai" ? ["pai", "mae"] : ["mae", "pai"];
  for (const qual of ordem) {
    const r = form[qual];
    if (responsavelPreenchido(r)) responsaveis.push(responsavelPayload(qual, r, form));
  }

  const financeiro = responsaveis.find((r) => r.responsavelFinanceiro) ?? responsaveis[0];

  return {
    submissionId,
    unidade: form.unidade,
    aluno: {
      nome: form.aluno.nome.trim(),
      dataNascimento: form.aluno.dataNascimento.trim(),
      cpf: soDigitos(form.aluno.cpf),
      sexo: form.aluno.genero,
      naturalidade: form.aluno.naturalidade.trim(),
      // Contato do aluno = do responsável financeiro (o formulário não coleta
      // telefone/e-mail do aluno).
      email: financeiro?.email ?? "",
      celular: financeiro?.celular ?? "",
      midia: MIDIA_MATRICULA_SITE,
    },
    endereco: enderecoPayload(form.endereco),
    responsaveis,
  };
}

// ─── Limite por IP ──────────────────────────────────────────────────────────

/**
 * true quando o IP já atingiu o teto de submissões na janela — a submissão é
 * recusada antes de qualquer escrita ou chamada ao Sponte.
 */
export function excedeuLimitePorIp(submissoesNaJanela: number): boolean {
  return submissoesNaJanela >= MAX_SUBMISSOES_POR_IP;
}

// Início da janela do limite, em ISO — usado no filtro da consulta.
export function inicioJanelaLimite(agoraISO: string): string {
  return new Date(Date.parse(agoraISO) - JANELA_LIMITE_MINUTOS * 60_000).toISOString();
}

// ─── Etapa 2: Rotina Escolar ────────────────────────────────────────────────
//
// Deliberadamente FORA de `MatriculaForm`: nada daqui pode chegar ao Sponte, e
// `montarPayloadMatricula` só enxerga `MatriculaForm`. A rotina tem destino
// próprio (tabela student_routine) e reaproveita os tipos do Diário do Aluno
// (MealKey/Weekday), para que a integração futura entre os dois seja direta.

export const DIAS_UTEIS: readonly Weekday[] = WEEKDAYS.map((d) => d.value);
export const REFEICOES_ROTINA: readonly MealKey[] = MEALS.map((m) => m.key);

export interface HorarioDia {
  entrada: string;
  saida: string;
}

// ─── Série calculada e horários fixos por segmento ──────────────────────────

export type SegmentoSerie = "infantil" | "fundamental";

/** Série calculada pela data de nascimento, com a MESMA regra de corte (31/03)
 * usada na admissão interna. Ano de referência opcional para testes. */
export function serieCalculada(dataNascimento: string, anoReferencia?: number): string {
  if (!dataValida(dataNascimento)) return "";
  return calcularIdadeEscolar(dataNascimento.trim(), anoReferencia).turma;
}

export function segmentoDaSerie(serie: string): SegmentoSerie {
  const indice = TURMAS_POR_IDADE.indexOf(serie.trim());
  return indice >= INDICE_PRIMEIRO_ANO ? "fundamental" : "infantil";
}

// Horários padrão praticados pelo colégio; o responsável marca o período, não
// digita o horário (só o Horário Estendido é preenchido dia a dia).
export const HORARIOS_PADRAO: Record<SegmentoSerie, { manha: HorarioDia; tarde: HorarioDia }> = {
  infantil: {
    manha: { entrada: "07:20", saida: "11:50" },
    tarde: { entrada: "13:00", saida: "17:30" },
  },
  fundamental: {
    manha: { entrada: "07:20", saida: "12:40" },
    tarde: { entrada: "13:00", saida: "18:20" },
  },
};

// Chave numérica do dia da semana (1=segunda … 5=sexta), como no Diário.
export type HorariosRotina = Partial<Record<Weekday, HorarioDia>>;
export type RefeicoesRotina = Record<MealKey, Weekday[]>;

export interface RotinaForm {
  dataInicio: string;
  // Marcado = o aluno NÃO frequenta os cinco dias úteis; só então os dias são
  // escolhidos manualmente.
  frequenciaParcial: boolean;
  diasSelecionados: Weekday[];
  periodoManha: boolean;
  periodoTarde: boolean;
  // Sai antes da manhã ou fica além da tarde: aí, e só aí, os horários são
  // digitados dia a dia.
  horarioEstendido: boolean;
  horarios: HorariosRotina;
  semRefeicoes: boolean;
  refeicoes: RefeicoesRotina;
}

export function refeicoesVazias(): RefeicoesRotina {
  return { breakfast: [], lunch: [], snack: [], dinner: [] };
}

export const ROTINA_FORM_VAZIA: RotinaForm = {
  dataInicio: "",
  frequenciaParcial: false,
  diasSelecionados: [...DIAS_UTEIS],
  periodoManha: false,
  periodoTarde: false,
  horarioEstendido: false,
  horarios: {},
  semRefeicoes: false,
  refeicoes: refeicoesVazias(),
};

/** Dias que aparecem na tabela de horários: os cinco úteis ou só os escolhidos. */
export function diasAtivosRotina(rotina: RotinaForm): Weekday[] {
  if (!rotina.frequenciaParcial) return [...DIAS_UTEIS];
  return DIAS_UTEIS.filter((d) => rotina.diasSelecionados.includes(d));
}

export function horarioValido(valor: string): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(valor.trim());
  return m !== null;
}

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function algumaRefeicaoMarcada(rotina: RotinaForm): boolean {
  const ativos = diasAtivosRotina(rotina);
  return REFEICOES_ROTINA.some((r) => rotina.refeicoes[r].some((d) => ativos.includes(d)));
}

/**
 * Horário de cada dia ativo. Sem horário estendido ele é DERIVADO dos períodos
 * marcados (entrada do primeiro período, saída do último), de modo que o que o
 * responsável vê no quadro fixo é exatamente o que fica gravado.
 */
export function horariosEfetivos(rotina: RotinaForm, serie: string): HorariosRotina {
  const ativos = diasAtivosRotina(rotina);
  const resultado: HorariosRotina = {};

  if (rotina.horarioEstendido) {
    for (const dia of ativos) {
      const h = rotina.horarios[dia];
      if (h) resultado[dia] = { entrada: h.entrada.trim(), saida: h.saida.trim() };
    }
    return resultado;
  }

  const padrao = HORARIOS_PADRAO[segmentoDaSerie(serie)];
  const entrada = rotina.periodoManha ? padrao.manha.entrada : padrao.tarde.entrada;
  const saida = rotina.periodoTarde ? padrao.tarde.saida : padrao.manha.saida;
  if (!rotina.periodoManha && !rotina.periodoTarde) return resultado;
  for (const dia of ativos) resultado[dia] = { entrada, saida };
  return resultado;
}

/**
 * Validação da etapa 2. Chaves de erro no mesmo formato da etapa 1
 * ("rotina.horario.1"), para a tela destacar campo a campo.
 */
export function validarRotinaForm(rotina: RotinaForm, serie: string): ErrosForm {
  const erros: ErrosForm = {};

  if (!dataValida(rotina.dataInicio)) erros["rotina.dataInicio"] = "Informe a data de início.";

  const ativos = diasAtivosRotina(rotina);
  if (ativos.length === 0)
    erros["rotina.dias"] = "Escolha ao menos um dia da semana que o aluno frequenta.";

  if (!rotina.periodoManha && !rotina.periodoTarde && !rotina.horarioEstendido)
    erros["rotina.periodos"] = "Marque a manhã, a tarde ou o horário estendido.";

  if (rotina.horarioEstendido) {
    for (const dia of ativos) {
      const h = rotina.horarios[dia];
      if (!h || !horarioValido(h.entrada) || !horarioValido(h.saida)) {
        erros[`rotina.horario.${dia}`] = "Informe os horários de entrada e saída.";
        continue;
      }
      if (minutos(h.saida) <= minutos(h.entrada))
        erros[`rotina.horario.${dia}`] = "A saída precisa ser depois da entrada.";
    }
  }

  if (!rotina.semRefeicoes && !algumaRefeicaoMarcada(rotina))
    erros["rotina.refeicoes"] =
      "Marque ao menos uma refeição em um dia ou selecione “Não vou contratar nenhuma refeição”.";

  return erros;
}

export interface RotinaPersistida {
  dataInicio: string;
  diasAtivos: Weekday[];
  periodoManha: boolean;
  periodoTarde: boolean;
  horarioEstendido: boolean;
  // Um item por dia ativo, sempre com entrada e saída preenchidas.
  horarios: { weekday: Weekday; entrada: string; saida: string }[];
  semRefeicoes: boolean;
  refeicoes: RefeicoesRotina;
}

/**
 * Normaliza a rotina para persistência: só dias ativos entram, e o checkbox de
 * "nenhuma refeição" zera a grade (a marcação da tela não sobrevive ao envio).
 */
export function montarRotinaPersistida(rotina: RotinaForm, serie: string): RotinaPersistida {
  const ativos = diasAtivosRotina(rotina);
  const refeicoes = refeicoesVazias();
  if (!rotina.semRefeicoes) {
    for (const r of REFEICOES_ROTINA)
      refeicoes[r] = DIAS_UTEIS.filter(
        (d) => ativos.includes(d) && rotina.refeicoes[r].includes(d),
      );
  }

  const horarios = horariosEfetivos(rotina, serie);

  return {
    dataInicio: rotina.dataInicio.trim(),
    diasAtivos: ativos,
    periodoManha: rotina.periodoManha,
    periodoTarde: rotina.periodoTarde,
    horarioEstendido: rotina.horarioEstendido,
    horarios: ativos.map((d) => ({
      weekday: d,
      entrada: horarios[d]?.entrada ?? "",
      saida: horarios[d]?.saida ?? "",
    })),
    semRefeicoes: rotina.semRefeicoes,
    refeicoes,
  };
}

/** Rotina já cadastrada (Diário do Aluno ou envio anterior), como vem do banco. */
export interface PlanoRotinaExistente {
  dataInicio?: string;
  horarios: { weekday: Weekday; entrada: string; saida: string }[];
  refeicoes: { meal: MealKey; weekday: Weekday }[];
}

/**
 * Converte um plano já cadastrado no formulário da etapa de rotina, usado como
 * sugestão inicial na Rematrícula. Horário que bate exatamente com o quadro
 * fixo da série vira checkbox de período; qualquer outro cai no horário
 * estendido, com os horários reais dia a dia.
 */
export function rotinaDoPlanoExistente(plano: PlanoRotinaExistente, serie: string): RotinaForm {
  const dias = DIAS_UTEIS.filter((d) => plano.horarios.some((h) => h.weekday === d));
  const horarios: HorariosRotina = {};
  for (const h of plano.horarios) {
    if (!DIAS_UTEIS.includes(h.weekday)) continue;
    horarios[h.weekday] = { entrada: h.entrada, saida: h.saida };
  }

  const padrao = HORARIOS_PADRAO[segmentoDaSerie(serie)];
  const entradas = new Set(dias.map((d) => horarios[d]?.entrada ?? ""));
  const saidas = new Set(dias.map((d) => horarios[d]?.saida ?? ""));
  const entrada = entradas.size === 1 ? [...entradas][0] : "";
  const saida = saidas.size === 1 ? [...saidas][0] : "";
  const manha = entrada === padrao.manha.entrada;
  const tarde = saida === padrao.tarde.saida;
  const soManha = manha && saida === padrao.manha.saida;
  const soTarde = tarde && entrada === padrao.tarde.entrada;
  const integral = manha && tarde;
  const padronizado = dias.length > 0 && (soManha || soTarde || integral);

  const refeicoes = refeicoesVazias();
  for (const r of plano.refeicoes) {
    if (!DIAS_UTEIS.includes(r.weekday)) continue;
    if (!refeicoes[r.meal].includes(r.weekday)) refeicoes[r.meal].push(r.weekday);
  }
  for (const chave of REFEICOES_ROTINA) refeicoes[chave].sort((a, b) => a - b);

  return {
    dataInicio: plano.dataInicio ?? "",
    frequenciaParcial: dias.length > 0 && dias.length < DIAS_UTEIS.length,
    diasSelecionados: dias.length > 0 ? dias : [...DIAS_UTEIS],
    periodoManha: padronizado && (soManha || integral),
    periodoTarde: padronizado && (soTarde || integral),
    horarioEstendido: dias.length > 0 && !padronizado,
    horarios,
    semRefeicoes: dias.length > 0 && plano.refeicoes.length === 0,
    refeicoes,
  };
}

// ─── Questionário de saúde ──────────────────────────────────────────────────

export const OPCOES_SAUDE = ["Sim", "Não"] as const;
export type OpcaoSaude = (typeof OPCOES_SAUDE)[number];

// Exigência do INEP nº 152/2014.
export const CORES_RACAS = [
  "Preta",
  "Amarela",
  "Branca",
  "Indígena",
  "Parda",
  "Não declarada",
] as const;

export interface RespostaSaude {
  opcao: OpcaoSaude | "";
  detalhe: string;
}

export const RESPOSTA_SAUDE_VAZIA: RespostaSaude = { opcao: "", detalhe: "" };

export interface ContatoEmergencia {
  nome: string;
  telefone: string;
  parentesco: string;
}

export interface PessoaAutorizada extends ContatoEmergencia {
  cpf: string;
}

export const CONTATO_EMERGENCIA_VAZIO: ContatoEmergencia = {
  nome: "",
  telefone: "",
  parentesco: "",
};

export const PESSOA_AUTORIZADA_VAZIA: PessoaAutorizada = { ...CONTATO_EMERGENCIA_VAZIO, cpf: "" };

export interface SaudeForm {
  contatosEmergencia: ContatoEmergencia[];
  alergia: RespostaSaude;
  problemaSaude: RespostaSaude;
  medicamentoContinuo: RespostaSaude;
  planoSaude: RespostaSaude;
  pessoasAutorizadas: PessoaAutorizada[];
  corRaca: string;
  outrasInformacoes: string;
}

export const SAUDE_FORM_VAZIO: SaudeForm = {
  contatosEmergencia: [],
  alergia: RESPOSTA_SAUDE_VAZIA,
  problemaSaude: RESPOSTA_SAUDE_VAZIA,
  medicamentoContinuo: RESPOSTA_SAUDE_VAZIA,
  planoSaude: RESPOSTA_SAUDE_VAZIA,
  pessoasAutorizadas: [],
  corRaca: "",
  outrasInformacoes: "",
};

/**
 * As duas listas repetíveis são gravadas como texto (uma pessoa por linha), no
 * mesmo campo que o painel interno já exibe. Linha em branco é descartada: a
 * família pode adicionar e desistir de preencher sem bloquear o envio.
 */
export function textoContatosEmergencia(contatos: readonly ContatoEmergencia[]): string {
  return contatos
    .map((c) =>
      [c.nome, c.parentesco, c.telefone]
        .map((p) => p.trim())
        .filter(Boolean)
        .join(" — "),
    )
    .filter((linha) => linha !== "")
    .join("\n");
}

export function textoPessoasAutorizadas(pessoas: readonly PessoaAutorizada[]): string {
  return pessoas
    .map((p) =>
      [p.nome, p.parentesco, p.telefone, p.cpf]
        .map((parte) => parte.trim())
        .filter(Boolean)
        .join(" — "),
    )
    .filter((linha) => linha !== "")
    .join("\n");
}

export const PERGUNTAS_SAUDE: readonly {
  campo: "alergia" | "problemaSaude" | "medicamentoContinuo" | "planoSaude";
  pergunta: string;
}[] = [
  { campo: "alergia", pergunta: "Apresenta alguma alergia?" },
  { campo: "problemaSaude", pergunta: "Possui algum problema de saúde?" },
  { campo: "medicamentoContinuo", pergunta: "Usa algum medicamento de uso contínuo?" },
  { campo: "planoSaude", pergunta: "Possui plano de saúde?" },
];

export function validarSaudeForm(saude: SaudeForm): ErrosForm {
  const erros: ErrosForm = {};

  // As duas listas (contatos de emergência e autorizados a buscar) são
  // opcionais: podem ficar vazias sem bloquear o envio.
  for (const { campo } of PERGUNTAS_SAUDE) {
    const resposta = saude[campo];
    if (resposta.opcao === "") {
      erros[`saude.${campo}`] = "Escolha uma opção.";
      continue;
    }
    if (resposta.opcao === "Sim" && resposta.detalhe.trim() === "")
      erros[`saude.${campo}.detalhe`] = "Explique brevemente.";
  }

  if (!CORES_RACAS.includes(saude.corRaca as (typeof CORES_RACAS)[number]))
    erros["saude.corRaca"] = "Escolha uma opção.";

  return erros;
}

// ─── Documentos ─────────────────────────────────────────────────────────────

export type DocumentoChave =
  | "certidao_ou_rg"
  | "identidade_responsavel"
  | "comprovante_residencia"
  | "carteira_vacinacao"
  | "declaracao_escolaridade"
  | "declaracao_transferencia"
  | "quitacao_escola_anterior";

export interface DocumentoMatricula {
  chave: DocumentoChave;
  rotulo: string;
  dica?: string;
  // Quando true, a falta bloqueia o envio em qualquer série.
  bloqueiaSempre: boolean;
  // Quando true, a falta bloqueia apenas do 1º Ano em diante.
  bloqueiaDoPrimeiroAno?: boolean;
}

export const DOCUMENTOS_MATRICULA: readonly DocumentoMatricula[] = [
  {
    chave: "certidao_ou_rg",
    rotulo: "Certidão de Nascimento ou RG do aluno(a)",
    bloqueiaSempre: true,
  },
  {
    chave: "identidade_responsavel",
    rotulo: "Documento de identidade do responsável financeiro",
    bloqueiaSempre: true,
  },
  {
    chave: "comprovante_residencia",
    rotulo: "Comprovante de residência do responsável financeiro",
    dica: "Emitido nos últimos 3 meses.",
    bloqueiaSempre: true,
  },
  {
    chave: "carteira_vacinacao",
    rotulo: "Carteira de vacinação do aluno(a)",
    dica: "Solicitada para alunos até 10 anos.",
    bloqueiaSempre: false,
  },
  {
    chave: "declaracao_escolaridade",
    rotulo: "Declaração de escolaridade",
    dica: "Se o(a) aluno(a) vem transferido de outra escola.",
    bloqueiaSempre: false,
  },
  {
    chave: "declaracao_transferencia",
    rotulo: "Declaração de transferência",
    dica: "Se o(a) aluno(a) vem transferido de outra escola.",
    bloqueiaSempre: false,
  },
  {
    chave: "quitacao_escola_anterior",
    rotulo: "Declaração de quitação de mensalidades da escola anterior",
    dica: "Se o(a) aluno(a) vem de escola pública, anexe aqui a Declaração de Escolaridade no lugar.",
    bloqueiaSempre: false,
    bloqueiaDoPrimeiroAno: true,
  },
];

export interface ArquivoDocumento {
  // Caminho dentro do bucket privado (nunca uma URL pública).
  path: string;
  nome: string;
  tipo: string;
  tamanho: number;
}

export type DocumentosForm = Partial<Record<DocumentoChave, ArquivoDocumento>>;

export const TIPOS_DOCUMENTO_ACEITOS: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
];

export const TAMANHO_MAX_DOCUMENTO = 10 * 1024 * 1024;

// Bucket PRIVADO: os arquivos só são abertos por link assinado, gerado para
// quem tem permissão de leitura do módulo Admissões.
export const BUCKET_DOCUMENTOS_MATRICULA = "matricula-documentos";

/** Regra interna de bloqueio (a tela pública não mostra "obrigatório"). */
export function documentoBloqueia(documento: DocumentoMatricula, serie: string): boolean {
  if (documento.bloqueiaSempre) return true;
  if (!documento.bloqueiaDoPrimeiroAno) return false;
  return segmentoDaSerie(serie) === "fundamental";
}

export function validarDocumentosForm(documentos: DocumentosForm, serie: string): ErrosForm {
  const erros: ErrosForm = {};
  for (const documento of DOCUMENTOS_MATRICULA) {
    if (!documentoBloqueia(documento, serie)) continue;
    if (!documentos[documento.chave])
      erros[`documentos.${documento.chave}`] = "Anexe este documento para concluir a matrícula.";
  }
  return erros;
}

// ─── Padronização de capitalização ──────────────────────────────────────────
//
// Só texto livre entra aqui: e-mail, CPF, telefone, CEP, datas e horários ficam
// exatamente como foram digitados.

function enderecoPadronizado(endereco: EnderecoForm): EnderecoForm {
  return {
    ...endereco,
    logradouro: toTitleCase(endereco.logradouro),
    complemento: toTitleCase(endereco.complemento),
    bairro: toTitleCase(endereco.bairro),
    cidade: toTitleCase(endereco.cidade),
  };
}

function responsavelPadronizado(responsavel: ResponsavelForm): ResponsavelForm {
  return {
    ...responsavel,
    nome: toTitleCase(responsavel.nome),
    endereco: enderecoPadronizado(responsavel.endereco),
  };
}

export function padronizarMatriculaForm(form: MatriculaForm): MatriculaForm {
  return {
    ...form,
    aluno: {
      ...form.aluno,
      nome: toTitleCase(form.aluno.nome),
      naturalidade: toTitleCase(form.aluno.naturalidade),
    },
    endereco: enderecoPadronizado(form.endereco),
    pai: responsavelPadronizado(form.pai),
    mae: responsavelPadronizado(form.mae),
  };
}

function respostaPadronizada(resposta: RespostaSaude): RespostaSaude {
  return { ...resposta, detalhe: toTitleCase(resposta.detalhe) };
}

export function padronizarSaudeForm(saude: SaudeForm): SaudeForm {
  return {
    ...saude,
    contatosEmergencia: saude.contatosEmergencia.map((c) => ({
      ...c,
      nome: toTitleCase(c.nome),
      parentesco: toTitleCase(c.parentesco),
    })),
    alergia: respostaPadronizada(saude.alergia),
    problemaSaude: respostaPadronizada(saude.problemaSaude),
    medicamentoContinuo: respostaPadronizada(saude.medicamentoContinuo),
    planoSaude: respostaPadronizada(saude.planoSaude),
    pessoasAutorizadas: saude.pessoasAutorizadas.map((p) => ({
      ...p,
      nome: toTitleCase(p.nome),
      parentesco: toTitleCase(p.parentesco),
    })),
    outrasInformacoes: toTitleCase(saude.outrasInformacoes),
  };
}
