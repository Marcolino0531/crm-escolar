// Envio em lote da Declaração de Imposto de Renda: lógica pura da prévia, do
// email e do resumo final.
//
// O lote não reimplementa a declaração — cada aluno passa exatamente pela mesma
// seleção de pagamentos e pelo mesmo gerador de PDF do documento individual
// (`imposto-renda.ts` / `declaracao-ir-pdf.ts`). Aqui mora só o que é próprio do
// lote: quem entra na lista, quem tem email, o conteúdo da mensagem e a
// contagem de sucesso/falha que o operador vê no fim.

/** Aluno ativo da unidade com o responsável financeiro que receberia o email. */
export interface AlunoLoteIR {
  alunoId: string;
  nome: string;
  turma: string;
  responsavelId: string;
  responsavelNome: string;
  responsavelCpf: string;
  responsavelEmail: string;
}

function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Unidade pedagógica do aluno pela turma, para separar o token compartilhado
 * CEC/CEC Baby. Mesma regra estrita do Diário: Berçário e Maternal são CEC
 * Baby; todo o resto (Jardim, Períodos, Anos) é CEC.
 */
export function unidadeDoAlunoIR(turma: string): "CEC" | "CEC Baby" {
  const t = normalizar(turma);
  if (t.includes("bercario") || t.includes("maternal")) return "CEC Baby";
  return "CEC";
}

/**
 * Alunos que pertencem à unidade escolhida. Unidade com credencial própria
 * (Belvedere, Vale do Sereno) devolve tudo o que o token retornou; unidade que
 * compartilha token é recortada pela turma.
 */
export function filtrarAlunosDaUnidade<T extends { turma: string }>(
  alunos: readonly T[],
  unidade: string,
  segmentaPorTurma: boolean,
): T[] {
  if (!segmentaPorTurma) return [...alunos];
  return alunos.filter((a) => unidadeDoAlunoIR(a.turma) === unidade);
}

/**
 * Email utilizável para envio. Exige uma forma mínima (algo@algo.tld) porque o
 * cadastro do Sponte aceita texto livre no campo: sem isso o lote gastaria uma
 * requisição por endereço inválido.
 */
export function emailValido(email: string): boolean {
  const e = (email ?? "").trim();
  if (e === "" || /\s/.test(e)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(e);
}

export interface ResumoPreviaLote {
  total: number;
  comEmail: number;
  semEmail: number;
}

/** Contagem exibida no topo da prévia. */
export function resumoPrevia(alunos: readonly AlunoLoteIR[]): ResumoPreviaLote {
  const comEmail = alunos.filter((a) => emailValido(a.responsavelEmail)).length;
  return { total: alunos.length, comEmail, semEmail: alunos.length - comEmail };
}

/** Quem efetivamente recebe email (a lista de destinatários do disparo). */
export function destinatariosLote(alunos: readonly AlunoLoteIR[]): AlunoLoteIR[] {
  return alunos.filter((a) => emailValido(a.responsavelEmail));
}

/** Quem aparece na prévia só para o operador avisar por outro meio. */
export function semEmailLote(alunos: readonly AlunoLoteIR[]): AlunoLoteIR[] {
  return alunos.filter((a) => !emailValido(a.responsavelEmail));
}

export function assuntoEmailIR(anoIR: number, nomeColegio: string): string {
  const colegio = (nomeColegio ?? "").trim();
  return colegio
    ? `Declaração de Imposto de Renda ${anoIR} — ${colegio}`
    : `Declaração de Imposto de Renda ${anoIR}`;
}

function escaparHtml(texto: string): string {
  return (texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface CorpoEmailIR {
  html: string;
  text: string;
}

/** Mensagem que acompanha o PDF, um email por aluno. */
export function corpoEmailIR(input: {
  responsavelNome: string;
  alunoNome: string;
  anoIR: number;
  anoReferencia: number;
  nomeColegio: string;
}): CorpoEmailIR {
  const saudacao = input.responsavelNome.trim() ? `Olá, ${input.responsavelNome.trim()}` : "Olá";
  const colegio = input.nomeColegio.trim() || "o colégio";
  const linhas = [
    `${saudacao},`,
    `Segue em anexo a Declaração de Imposto de Renda ${input.anoIR} (ano-calendário ` +
      `${input.anoReferencia}) do(a) aluno(a) ${input.alunoNome.trim()}, com os valores de ` +
      "matrícula e mensalidades pagos no período, para fins de dedução de despesas com instrução.",
    "Em caso de divergência, responda a este email que verificamos o lançamento.",
    `Atenciosamente,\n${colegio}`,
  ];
  return {
    text: linhas.join("\n\n"),
    html: linhas.map((l) => `<p>${escaparHtml(l).replace(/\n/g, "<br />")}</p>`).join("\n"),
  };
}

export type ResultadoEnvioLote = {
  alunoId: string;
  alunoNome: string;
  email: string;
  ok: boolean;
  erro?: string;
};

export interface ResumoEnvioLote {
  enviados: number;
  falhas: number;
}

/** Resumo final: conta o que de fato foi enviado e o que falhou. */
export function resumoEnvio(resultados: readonly ResultadoEnvioLote[]): ResumoEnvioLote {
  const enviados = resultados.filter((r) => r.ok).length;
  return { enviados, falhas: resultados.length - enviados };
}

/** Falhas do lote, na ordem em que ocorreram — base do reenvio seletivo. */
export function falhasDoLote(resultados: readonly ResultadoEnvioLote[]): ResultadoEnvioLote[] {
  return resultados.filter((r) => !r.ok);
}

/**
 * Substitui os resultados dos alunos reprocessados, preservando a ordem e os
 * resultados de quem não entrou no reenvio. É assim que o resumo continua
 * batendo com o total real após reenviar só as falhas.
 */
export function mesclarResultados(
  anteriores: readonly ResultadoEnvioLote[],
  novos: readonly ResultadoEnvioLote[],
): ResultadoEnvioLote[] {
  const porAluno = new Map(novos.map((r) => [r.alunoId, r]));
  return anteriores.map((r) => porAluno.get(r.alunoId) ?? r);
}

// Ritmo do disparo. O limite da Resend é por segundo (10 req/s no padrão da
// conta), então o lote vai um email por vez com uma pausa entre eles: sobra
// folga no limite e o volume não chega ao provedor do destinatário em rajada.
export const INTERVALO_ENVIO_MS = 1000;

/** Nome do anexo enviado ao responsável. */
export function nomeAnexoDeclaracaoIR(alunoNome: string, anoIR: number): string {
  const aluno = (alunoNome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
  return `declaracao-ir-${anoIR}-${aluno || "aluno"}.pdf`;
}
