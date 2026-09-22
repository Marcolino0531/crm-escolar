// Alunos Matriculados Ativos — agregação pura sobre diario_matriculas_ano.
// Fonte: vínculo aluno × ano letivo (ativo=true) sincronizado diariamente com o
// Sponte, por unidade. Substitui a contagem via GetAlunos Situacao=Ativo, que
// não filtra por ano e incluía alunos já matriculados para o ano seguinte.

export interface VinculoAtivoRow {
  student_id: string;
  school_id: string;
}

export interface HistoricoRow {
  school_id: string;
  ano_mes: string;
  total_alunos: number;
}

// Alunos DISTINTOS por unidade (um aluno com duas linhas na mesma unidade conta 1).
export function contarAtivosPorUnidade(rows: readonly VinculoAtivoRow[]): Record<string, number> {
  const porUnidade = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.school_id || !r.student_id) continue;
    let set = porUnidade.get(r.school_id);
    if (!set) {
      set = new Set();
      porUnidade.set(r.school_id, set);
    }
    set.add(r.student_id);
  }
  const out: Record<string, number> = {};
  for (const [schoolId, set] of porUnidade) out[schoolId] = set.size;
  return out;
}

// Unidades pedidas que não têm NENHUM vínculo no ano (sincronização ainda não
// rodou): o card deve avisar, não mostrar zero como se fosse dado real.
export function unidadesSemDados(
  schoolIds: readonly string[],
  porUnidade: Readonly<Record<string, number>>,
): string[] {
  return schoolIds.filter((id) => !(id in porUnidade));
}

export function somarTotal(porUnidade: Readonly<Record<string, number>>): number {
  return Object.values(porUnidade).reduce((s, n) => s + n, 0);
}

// ── Histórico mensal ────────────────────────────────────────────────────────

export function anoMesDe(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

// `data` é interpretada no calendário local do processo (o cron roda em UTC;
// ver `hojeEmBrasilia`).
export function ehUltimoDiaDoMes(data: Date): boolean {
  const amanha = new Date(data.getFullYear(), data.getMonth(), data.getDate() + 1);
  return amanha.getMonth() !== data.getMonth();
}

// Data civil de Brasília (UTC-3) a partir de um instante qualquer.
export function hojeEmBrasilia(agora: Date = new Date()): Date {
  const brt = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return new Date(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate());
}

// Linhas a gravar no fechamento do mês: uma por unidade com dado. Unidades sem
// vínculo NÃO entram (não gravamos zero de sincronização ausente).
export function linhasHistoricoDoMes(
  porUnidade: Readonly<Record<string, number>>,
  anoMes: string,
): HistoricoRow[] {
  return Object.entries(porUnidade)
    .map(([school_id, total_alunos]) => ({ school_id, ano_mes: anoMes, total_alunos }))
    .sort((a, b) => a.school_id.localeCompare(b.school_id));
}

// Aplica um upsert em memória (chave school_id + ano_mes): reexecutar o mesmo
// fechamento no mesmo dia substitui a linha em vez de duplicar.
export function aplicarUpsertHistorico(
  existentes: readonly HistoricoRow[],
  novas: readonly HistoricoRow[],
): HistoricoRow[] {
  const mapa = new Map<string, HistoricoRow>();
  for (const r of [...existentes, ...novas]) mapa.set(`${r.school_id}|${r.ano_mes}`, { ...r });
  return [...mapa.values()].sort(
    (a, b) => a.ano_mes.localeCompare(b.ano_mes) || a.school_id.localeCompare(b.school_id),
  );
}

export interface PontoHistorico {
  month: string; // "MM/AA", mesmo formato dos demais gráficos do Dashboard
  anoMes: string;
  total: number;
}

// Série do gráfico: soma das unidades do filtro por mês, só com os meses que
// existem no histórico (nada retroativo inventado). Em "Todas as Unidades"
// (`schoolIds` = null) soma tudo.
export function serieHistorico(
  rows: readonly HistoricoRow[],
  schoolIds: readonly string[] | null,
): PontoHistorico[] {
  const filtro = schoolIds ? new Set(schoolIds) : null;
  const porMes = new Map<string, number>();
  for (const r of rows) {
    if (filtro && !filtro.has(r.school_id)) continue;
    porMes.set(r.ano_mes, (porMes.get(r.ano_mes) ?? 0) + Number(r.total_alunos));
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([anoMes, total]) => ({
      anoMes,
      month: `${anoMes.slice(5, 7)}/${anoMes.slice(2, 4)}`,
      total,
    }));
}
