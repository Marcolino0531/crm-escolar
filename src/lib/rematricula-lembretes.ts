// Regras puras do lembrete SEMANAL de rematrícula por WhatsApp.
//
// A fonte é a mesma coleção da tela "Rematrícula — Acompanhamento": uma linha
// por aluno ATIVO do Sponte com o status derivado do que o portal gravou. Só
// quem ainda não concluiu recebe lembrete — e cada status tem o seu template:
//   nao_iniciado         → template "não iniciado"  (nunca abriu o portal)
//   em_andamento         → template "em andamento"  (abriu, não confirmou)
//   aguardando_aprovacao → nada (já confirmou; falta a secretaria lançar)
//   rematriculado        → nada (título lançado no Sponte)

import type { LinhaAcompanhamento, StatusAcompanhamento } from "./rematricula-acompanhamento";

export type TemplateRematricula = "nao_iniciado" | "em_andamento";

// Nome do template aprovado na Meta para cada situação. Configurável por env
// (o mesmo nome nos dois números/WABAs, como nas outras réguas).
export const TEMPLATES_REMATRICULA_PADRAO: Record<TemplateRematricula, string> = {
  nao_iniciado: "rematricula_lembrete_nao_iniciado",
  em_andamento: "rematricula_lembrete_em_andamento",
};

export function templateRematricula(status: StatusAcompanhamento): TemplateRematricula | null {
  if (status === "nao_iniciado" || status === "em_andamento") return status;
  return null;
}

export interface LembreteRematricula {
  alunoId: string;
  alunoNome: string;
  unidade: string;
  turma: string;
  // Status da tela de acompanhamento NO MOMENTO da seleção — é o que fica no log.
  status: TemplateRematricula;
  template: TemplateRematricula;
}

// Um lembrete por aluno (irmãos geram uma mensagem cada, nomeando o aluno).
// Quem já respondeu (aguardando aprovação/rematriculado) fica de fora.
export function selecionarLembretesRematricula(
  linhas: readonly LinhaAcompanhamento[],
): LembreteRematricula[] {
  const selecionados: LembreteRematricula[] = [];
  for (const l of linhas) {
    const template = templateRematricula(l.status);
    if (!template) continue;
    selecionados.push({
      alunoId: l.alunoId,
      alunoNome: l.nome,
      unidade: l.unidade,
      turma: l.turma,
      status: template,
      template,
    });
  }
  return selecionados;
}

// Chave da trava de idempotência do dia: o mesmo aluno da mesma unidade não
// recebe o lembrete duas vezes na mesma rodada (retry, reexecução manual).
export function chaveLembrete(unidade: string, alunoId: string): string {
  return `${unidade}::${alunoId}`;
}

export function filtrarJaLembrados(
  lembretes: readonly LembreteRematricula[],
  jaLembrados: ReadonlySet<string>,
): { pendentes: LembreteRematricula[]; pulados: number } {
  const pendentes = lembretes.filter((l) => !jaLembrados.has(chaveLembrete(l.unidade, l.alunoId)));
  return { pendentes, pulados: lembretes.length - pendentes.length };
}

export function contarPorTemplate(
  lembretes: readonly LembreteRematricula[],
): Record<TemplateRematricula, number> {
  const contagem: Record<TemplateRematricula, number> = { nao_iniciado: 0, em_andamento: 0 };
  for (const l of lembretes) contagem[l.template]++;
  return contagem;
}

// Dia da semana do disparo (YYYY-MM-DD, sem fuso: a data já vem no fuso de SP).
export function ehSextaFeira(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 5;
}

export interface RematriculaTemplateVars {
  to: string;
  responsavel: string;
  aluno: string;
  unidade: string;
  anoLetivo: string;
  link: string;
}

// Texto fiel de cada template (Utilidade, pt_BR), na ordem das variáveis:
// {{1}} Responsável · {{2}} Aluno · {{3}} Unidade · {{4}} Ano letivo · {{5}} Link.
export function renderRematriculaMessage(
  template: TemplateRematricula,
  vars: RematriculaTemplateVars,
): string {
  if (template === "nao_iniciado") {
    return (
      `Olá ${vars.responsavel}, a rematrícula ${vars.anoLetivo} do(a) aluno(a) ${vars.aluno} ` +
      `(${vars.unidade}) já está aberta e ainda não foi iniciada. ` +
      `Acesse ${vars.link}, confira os dados e escolha o parcelamento do material pedagógico. ` +
      `Qualquer dúvida, a secretaria está à disposição.`
    );
  }
  return (
    `Olá ${vars.responsavel}, notamos que a rematrícula ${vars.anoLetivo} do(a) aluno(a) ${vars.aluno} ` +
    `(${vars.unidade}) foi iniciada mas ainda não foi concluída. ` +
    `Acesse ${vars.link} para confirmar o parcelamento do material pedagógico e garantir a vaga. ` +
    `Qualquer dúvida, a secretaria está à disposição.`
  );
}
