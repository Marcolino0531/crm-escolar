// Sincronização do Diário do Aluno com o Sponte, POR ANO LETIVO (lógica pura).
//
// Fonte: GetMatriculas com DataInicio=01/01/AAAA;DataTermino=31/12/AAAA, uma
// chamada por unidade/ano, que devolve os contratos daquele ano com a turma
// DAQUELE ano (NomeTurma). GetAlunos não filtra por ano e o seu TurmaAtual já
// reflete a rematrícula do ano seguinte — por isso não serve para o Diário.
//
// Modelo: diario_students é a identidade do aluno (uma linha por aluno/unidade);
// diario_matriculas_ano diz em quais anos ele tem contrato vigente e com qual
// turma. Sincronizar um ano só cria/atualiza/inativa vínculos DESSE ano.

export type UnidadeDiario = "CEC" | "CEC Baby";

export interface ContratoSponte {
  alunoId: string;
  nome: string;
  turma: string;
  contratoId: string;
  situacao: string;
}

// Valor de uma tag de PRIMEIRO NÍVEL do nó: sub-blocos (ex.: <Disciplinas>,
// cujos <wsDisciplinas> têm a própria tag <Nome>) são removidos antes da busca.
export function valorTopoXml(node: string, tag: string): string {
  const interno = node
    .trim()
    .replace(/^<[A-Za-z_][\w.-]*[^>]*>/, "")
    .replace(/<\/[A-Za-z_][\w.-]*>\s*$/, "");
  const semSubBlocos = interno.replace(/<([A-Za-z_][\w.-]*)[^>]*>(?=\s*<)[\s\S]*?<\/\1>/g, "");
  const m = semSubBlocos.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

// Um <wsMatricula> do GetMatriculas. O nome do aluno vem na tag <Aluno>
// (top-level); <Nome> só existe dentro de <Disciplinas>/<wsDisciplinas>.
export function parseWsMatricula(node: string): ContratoSponte {
  return {
    alunoId: valorTopoXml(node, "AlunoID"),
    nome: valorTopoXml(node, "Aluno"),
    turma: valorTopoXml(node, "NomeTurma"),
    contratoId: valorTopoXml(node, "ContratoID"),
    situacao: valorTopoXml(node, "Situacao"),
  };
}

export interface AlunoDoAno {
  sponteId: string;
  nome: string;
  turma: string;
  contratoId: string | null;
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Regra estrita de distribuição do token compartilhado CEC/CEC Baby: turmas de
// Berçário até Maternal 3 vão obrigatoriamente para "CEC Baby"; todas as demais
// (Jardim, Períodos, Anos etc.) vão para "CEC". Aplicada à turma DO ANO, para
// que um Maternal 3 de 2026 rematriculado no 1º Período de 2027 fique no CEC
// Baby em 2026 e no CEC em 2027.
export function unidadeDestinoDiario(turma: string): UnidadeDiario {
  const t = normalizar(turma);
  if (t.includes("bercario") || t.includes("maternal")) return "CEC Baby";
  return "CEC";
}

export function contratoVigente(situacao: string): boolean {
  return normalizar(situacao).trim() === "vigente";
}

// Alunos com contrato vigente no ano, um por AlunoID. Se o aluno tiver mais de
// um contrato vigente no mesmo ano (troca de turma), vale o de maior ContratoID
// (o mais recente).
export function alunosVigentesDoAno(contratos: readonly ContratoSponte[]): AlunoDoAno[] {
  const porAluno = new Map<string, AlunoDoAno>();
  for (const c of contratos) {
    if (!c.alunoId || c.alunoId === "0") continue;
    if (!contratoVigente(c.situacao)) continue;
    const atual = porAluno.get(c.alunoId);
    const contratoId = c.contratoId && c.contratoId !== "0" ? c.contratoId : null;
    if (atual && Number(atual.contratoId ?? 0) >= Number(contratoId ?? 0)) continue;
    porAluno.set(c.alunoId, {
      sponteId: c.alunoId,
      nome: c.nome.trim(),
      turma: c.turma.trim(),
      contratoId,
    });
  }
  return [...porAluno.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

export interface VinculoAno {
  studentId: string;
  anoLetivo: number;
  turmaNome: string;
  ativo: boolean;
}

export interface VinculoUpsert {
  student_id: string;
  ano_letivo: number;
  turma_nome: string;
  contrato_sponte_numero: string | null;
  ativo: true;
}

export interface PlanoSincronizacaoAno {
  upserts: VinculoUpsert[];
  // student_id dos vínculos ativos DESTE ano que não vieram mais do Sponte.
  inativar: string[];
}

// Dado o ano sincronizado, os alunos vindos do Sponte (já resolvidos para o
// student_id do Diário) e os vínculos existentes, devolve o que gravar. Só
// vínculos do próprio ano entram em `inativar`; outros anos nunca são tocados.
export function planejarSincronizacaoAno(
  anoLetivo: number,
  alunos: readonly { studentId: string; turma: string; contratoId: string | null }[],
  existentes: readonly VinculoAno[],
): PlanoSincronizacaoAno {
  const upserts: VinculoUpsert[] = [];
  const vistos = new Set<string>();
  for (const a of alunos) {
    if (vistos.has(a.studentId)) continue;
    vistos.add(a.studentId);
    upserts.push({
      student_id: a.studentId,
      ano_letivo: anoLetivo,
      turma_nome: a.turma,
      contrato_sponte_numero: a.contratoId,
      ativo: true,
    });
  }
  const inativar = existentes
    .filter((v) => v.anoLetivo === anoLetivo && v.ativo && !vistos.has(v.studentId))
    .map((v) => v.studentId);
  return { upserts, inativar };
}

// Turma "mais recente conhecida" do aluno: a do vínculo ativo de maior ano.
export function turmaMaisRecente(vinculos: readonly VinculoAno[]): string | null {
  let melhor: VinculoAno | null = null;
  for (const v of vinculos) {
    if (!v.ativo) continue;
    if (!melhor || v.anoLetivo > melhor.anoLetivo) melhor = v;
  }
  return melhor ? melhor.turmaNome : null;
}

// student_id → turma dos alunos com vínculo ativo no ano (quem lista por ano).
export function turmasDoAno(
  vinculos: readonly VinculoAno[],
  anoLetivo: number,
): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const v of vinculos) {
    if (v.ativo && v.anoLetivo === anoLetivo) mapa.set(v.studentId, v.turmaNome);
  }
  return mapa;
}

// Quantos vínculos mudaram de turma em relação ao que a tela mostrava antes
// (class_name em diario_students) — conferência do backfill.
export function contarTurmasCorrigidas(
  upserts: readonly VinculoUpsert[],
  turmaAnterior: ReadonlyMap<string, string>,
): number {
  let n = 0;
  for (const u of upserts) {
    const antes = turmaAnterior.get(u.student_id);
    if (antes !== undefined && antes !== u.turma_nome) n++;
  }
  return n;
}
