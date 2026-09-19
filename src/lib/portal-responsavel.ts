// Portal do Responsável — lógica pura (sem rede, sem banco), testável.
//
// Fluxo do login:
//  1. O CPF do responsável é consultado em CADA credencial Sponte em paralelo
//     (CEC/CEC Baby compartilham uma base; Belvedere e Vale do Sereno têm a sua).
//  2. Cada credencial devolve os AlunoIDs vinculados; o vínculo NÃO diz a
//     unidade nem a situação, então cada AlunoID fica marcado com as unidades
//     que aquela credencial atende (1 ou 2).
//  3. O cruzamento com diario_matriculas_ano (ano vigente, ativo) resolve a
//     unidade exata e descarta quem não está ativo.

import { LINK_VALIDADE_MINUTOS } from "@/lib/rematricula";

export const CHAVE_SESSAO_PORTAL = "portal:sessao";

export const MENSAGEM_CPF_NAO_LOCALIZADO =
  "CPF não localizado. Confira os dígitos ou fale com a secretaria do colégio.";

export const MENSAGEM_SEM_ALUNO_ATIVO =
  "Nenhum aluno ativo neste ano letivo foi encontrado para este CPF.";

/** Uma credencial Sponte e as unidades que ela atende. */
export interface CredencialPortal {
  unidades: string[];
}

/** Resultado bruto de GetResponsaveis em uma credencial. */
export interface RetornoCredencial {
  unidades: string[];
  alunoIds: readonly (number | string)[];
  responsavelNome?: string;
  email?: string;
}

/** AlunoID com as unidades em que ele PODE estar (antes do cruzamento). */
export interface VinculoCandidato {
  alunoId: string;
  unidadesPossiveis: string[];
}

/** Aluno da sessão: unidade já resolvida. */
export interface AlunoPortal {
  unidade: string;
  alunoId: string;
  nome: string;
  turma: string;
}

/** Linha de diario_students × diario_matriculas_ano já resolvida para o nome da unidade. */
export interface MatriculaAtiva {
  unidade: string;
  alunoId: string;
  nome: string;
  turma: string;
}

/**
 * Agrupa as unidades que compartilham a mesma credencial (mesma variável de
 * ambiente do código do cliente), preservando a ordem de declaração.
 */
export function agruparUnidadesPorCredencial(
  config: Readonly<Record<string, { codigoEnv: string }>>,
): CredencialPortal[] {
  const porEnv = new Map<string, string[]>();
  for (const [unidade, cfg] of Object.entries(config)) {
    const lista = porEnv.get(cfg.codigoEnv) ?? [];
    lista.push(unidade);
    porEnv.set(cfg.codigoEnv, lista);
  }
  return [...porEnv.values()].map((unidades) => ({ unidades }));
}

/**
 * Une os AlunoIDs devolvidos por cada credencial, deduplicando por
 * (alunoId, unidade). O mesmo AlunoID em credenciais diferentes são alunos
 * DIFERENTES (bases distintas), por isso a chave inclui a unidade.
 */
export function unirVinculos(retornos: readonly RetornoCredencial[]): VinculoCandidato[] {
  const porAluno = new Map<string, Set<string>>();
  for (const r of retornos) {
    for (const bruto of r.alunoIds) {
      const alunoId = String(bruto).trim();
      if (!/^\d+$/.test(alunoId) || Number(alunoId) <= 0) continue;
      const set = porAluno.get(alunoId) ?? new Set<string>();
      for (const u of r.unidades) set.add(u);
      porAluno.set(alunoId, set);
    }
  }
  return [...porAluno.entries()].map(([alunoId, unidades]) => ({
    alunoId,
    unidadesPossiveis: [...unidades],
  }));
}

/**
 * Cruza os candidatos com as matrículas ativas do ano vigente. Só sobra quem
 * tem linha ativa em uma das unidades possíveis daquela credencial — o que
 * resolve, de uma vez, a unidade exata (CEC × CEC Baby) e o filtro de ativo.
 */
export function filtrarAlunosAtivos(
  candidatos: readonly VinculoCandidato[],
  matriculas: readonly MatriculaAtiva[],
): AlunoPortal[] {
  const vistos = new Set<string>();
  const saida: AlunoPortal[] = [];
  for (const c of candidatos) {
    for (const m of matriculas) {
      if (m.alunoId !== c.alunoId || !c.unidadesPossiveis.includes(m.unidade)) continue;
      const chave = `${m.unidade}\u0000${m.alunoId}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push({ unidade: m.unidade, alunoId: m.alunoId, nome: m.nome, turma: m.turma });
    }
  }
  return saida.sort(
    (a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.unidade.localeCompare(b.unidade, "pt-BR"),
  );
}

/** Confere se (unidade, alunoId) pertence à lista da sessão. */
export function alunoDaSessao(
  alunos: readonly Pick<AlunoPortal, "unidade" | "alunoId">[],
  unidade: string,
  alunoId: string,
): boolean {
  return alunos.some((a) => a.unidade === unidade && a.alunoId === alunoId);
}

/**
 * Email do responsável: o primeiro não vazio entre as credenciais que o
 * encontraram (o cadastro costuma ser o mesmo em todas).
 */
export function emailDoResponsavel(retornos: readonly RetornoCredencial[]): string {
  for (const r of retornos) {
    const email = (r.email ?? "").trim();
    if (email.includes("@")) return email;
  }
  return "";
}

export function nomeDoResponsavel(retornos: readonly RetornoCredencial[]): string {
  for (const r of retornos) {
    const nome = (r.responsavelNome ?? "").trim();
    if (nome) return nome;
  }
  return "";
}

export function urlLinkPortal(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/portal?token=${encodeURIComponent(token)}`;
}

export function assuntoEmailPortal(): string {
  return "Seu acesso ao Portal do Responsável";
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function corpoEmailPortal(input: {
  responsavelNome: string;
  alunos: readonly Pick<AlunoPortal, "nome" | "unidade">[];
  url: string;
  emailMascarado: string;
}): { html: string; text: string } {
  const saudacao = input.responsavelNome.trim() ? `Olá, ${input.responsavelNome.trim()}` : "Olá";
  const lista = input.alunos.map((a) => `${a.nome} (${a.unidade})`).join(", ");
  const linhas = [
    `${saudacao},`,
    `Para acessar o Portal do Responsável (boletos, contratos e declarações)${
      lista ? ` de ${lista}` : ""
    }, use o link abaixo:`,
    input.url,
    ...(input.emailMascarado ? [`Este link foi enviado para ${input.emailMascarado}.`] : []),
    `O link vale por ${LINK_VALIDADE_MINUTOS} minutos e só pode ser usado uma vez. Se ele expirar, ` +
      "basta informar o CPF novamente no portal e pedir um novo.",
    "Se você não solicitou este acesso, ignore este email.",
  ];
  const url = escaparHtml(input.url);
  return {
    text: linhas.join("\n\n"),
    html: linhas
      .map((l) =>
        l === input.url ? `<p><a href="${url}">${url}</a></p>` : `<p>${escaparHtml(l)}</p>`,
      )
      .join("\n"),
  };
}

// ─── Contratos ──────────────────────────────────────────────────────────────

export type StatusContratoPortal = "gerando" | "aguardando_assinatura" | "assinado" | "erro";

/**
 * Status que o responsável vê, derivado de contratos_matricula.status e do
 * status do documento na ZapSign (quando existe).
 */
export function statusContratoPortal(
  contratoStatus: string,
  zapsignStatus: string | null | undefined,
): StatusContratoPortal {
  if (contratoStatus === "erro") return "erro";
  if (contratoStatus !== "enviado") return "gerando";
  if (zapsignStatus === "signed") return "assinado";
  if (zapsignStatus === "refused") return "erro";
  return "aguardando_assinatura";
}

export const ROTULO_STATUS_CONTRATO: Record<StatusContratoPortal, string> = {
  gerando: "Gerando",
  aguardando_assinatura: "Aguardando assinatura",
  assinado: "Assinado",
  erro: "Indisponível — fale com a secretaria",
};
