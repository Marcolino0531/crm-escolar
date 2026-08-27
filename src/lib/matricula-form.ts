// Regras puras do formulário público de matrícula (/matricula).
//
// Ficam isoladas de React e de rede porque são a barreira que evita erro de
// digitação chegar ao Sponte: validação de CPF (dígito verificador), campos
// obrigatórios e a montagem do payload no MESMO contrato que o webhook do
// Google Forms usa hoje (MatriculaSchema → processarMatricula).
//
// A página é pública, então há também o limite de submissões por IP: a contagem
// vem do banco e a decisão de recusar é tomada aqui.

import { MEALS, WEEKDAYS, type MealKey, type Weekday } from "@/lib/diario";
import type { MatriculaPayload, ResponsavelMatricula } from "@/lib/matriculas.sponte";

export const MAX_SUBMISSOES_POR_IP = 5;
export const JANELA_LIMITE_MINUTOS = 60;

export const ORIGEM_SITE = "site";
export const ORIGEM_GOOGLE_FORMS = "google_forms";

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

export interface MatriculaForm {
  unidade: string;
  aluno: {
    nome: string;
    cpf: string;
    dataNascimento: string;
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
  aluno: { nome: "", cpf: "", dataNascimento: "", naturalidade: "" },
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
  // CPF do aluno é opcional no Sponte, mas se vier precisa ser válido.
  if (form.aluno.cpf.trim() !== "" && !cpfCompletoValido(form.aluno.cpf))
    erros["aluno.cpf"] = "CPF inválido — confira os dígitos.";
  if (!dataNascimentoValida(form.aluno.dataNascimento, hojeYMD))
    erros["aluno.dataNascimento"] = "Informe uma data de nascimento válida.";
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
      naturalidade: form.aluno.naturalidade.trim(),
      // Contato do aluno = do responsável financeiro (o formulário não coleta
      // telefone/e-mail do aluno).
      email: financeiro?.email ?? "",
      celular: financeiro?.celular ?? "",
      midia: "Site — Formulário de matrícula",
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

export const MEIO_PERIODO_MANHA = { entrada: "07:20", saida: "11:50" } as const;
export const MEIO_PERIODO_TARDE = { entrada: "13:00", saida: "17:30" } as const;

export interface HorarioDia {
  entrada: string;
  saida: string;
}

// Chave numérica do dia da semana (1=segunda … 5=sexta), como no Diário.
export type HorariosRotina = Partial<Record<Weekday, HorarioDia>>;
export type RefeicoesRotina = Record<MealKey, Weekday[]>;

export interface RotinaForm {
  dataInicio: string;
  // Marcado = o aluno NÃO frequenta os cinco dias úteis; só então os dias são
  // escolhidos manualmente.
  frequenciaParcial: boolean;
  diasSelecionados: Weekday[];
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
 * Validação da etapa 2. Chaves de erro no mesmo formato da etapa 1
 * ("rotina.horario.1"), para a tela destacar campo a campo.
 */
export function validarRotinaForm(rotina: RotinaForm): ErrosForm {
  const erros: ErrosForm = {};

  if (!dataValida(rotina.dataInicio)) erros["rotina.dataInicio"] = "Informe a data de início.";

  const ativos = diasAtivosRotina(rotina);
  if (ativos.length === 0)
    erros["rotina.dias"] = "Escolha ao menos um dia da semana que o aluno frequenta.";

  for (const dia of ativos) {
    const h = rotina.horarios[dia];
    if (!h || !horarioValido(h.entrada) || !horarioValido(h.saida)) {
      erros[`rotina.horario.${dia}`] = "Informe os horários de entrada e saída.";
      continue;
    }
    if (minutos(h.saida) <= minutos(h.entrada))
      erros[`rotina.horario.${dia}`] = "A saída precisa ser depois da entrada.";
  }

  if (!rotina.semRefeicoes && !algumaRefeicaoMarcada(rotina))
    erros["rotina.refeicoes"] =
      "Marque ao menos uma refeição em um dia ou selecione “Não vou contratar nenhuma refeição”.";

  return erros;
}

export interface RotinaPersistida {
  dataInicio: string;
  diasAtivos: Weekday[];
  // Um item por dia ativo, sempre com entrada e saída preenchidas.
  horarios: { weekday: Weekday; entrada: string; saida: string }[];
  semRefeicoes: boolean;
  refeicoes: RefeicoesRotina;
}

/**
 * Normaliza a rotina para persistência: só dias ativos entram, e o checkbox de
 * "nenhuma refeição" zera a grade (a marcação da tela não sobrevive ao envio).
 */
export function montarRotinaPersistida(rotina: RotinaForm): RotinaPersistida {
  const ativos = diasAtivosRotina(rotina);
  const refeicoes = refeicoesVazias();
  if (!rotina.semRefeicoes) {
    for (const r of REFEICOES_ROTINA)
      refeicoes[r] = DIAS_UTEIS.filter(
        (d) => ativos.includes(d) && rotina.refeicoes[r].includes(d),
      );
  }

  return {
    dataInicio: rotina.dataInicio.trim(),
    diasAtivos: ativos,
    horarios: ativos.map((d) => ({
      weekday: d,
      entrada: rotina.horarios[d]?.entrada.trim() ?? "",
      saida: rotina.horarios[d]?.saida.trim() ?? "",
    })),
    semRefeicoes: rotina.semRefeicoes,
    refeicoes,
  };
}
