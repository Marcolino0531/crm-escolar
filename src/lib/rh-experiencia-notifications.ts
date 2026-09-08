// Avisos de fim do contrato de experiência no sininho: 45 dias, prorrogáveis
// por mais 45 (90 no total). O aviso aparece na véspera de cada marco
// (admissão + 44 e admissão + 89 dias) e fica na lista até alguém marcar como
// lido — não some sozinho com o tempo, para o prazo não passar sem decisão.
//
// Marcar como lido NÃO apaga: `rh_experiencia_notificacoes_lidas` guarda a
// linha por funcionário e marco, e o aviso só sai da lista de pendentes.

export type MarcoExperiencia = 45 | 90;

export const MARCOS_EXPERIENCIA: readonly MarcoExperiencia[] = [45, 90];

export interface FuncionarioExperiencia {
  id: string;
  nome: string;
  // Datas em YYYY-MM-DD (como gravadas em `funcionarios`).
  dataAdmissao: string | null | undefined;
  dataRescisao: string | null | undefined;
}

export interface AvisoLido {
  funcionarioId: string;
  marco: MarcoExperiencia;
}

export interface AvisoExperiencia {
  funcionarioId: string;
  nome: string;
  marco: MarcoExperiencia;
  // Dia em que o marco se completa (admissão + 45 ou + 90), YYYY-MM-DD.
  dataMarco: string;
  // Dia em que o aviso passa a aparecer (véspera do marco), YYYY-MM-DD.
  dataAviso: string;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function somarDias(dataISO: string, dias: number): string {
  const [a, m, d] = dataISO.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

export function dataMarcoExperiencia(dataAdmissao: string, marco: MarcoExperiencia): string {
  return somarDias(dataAdmissao, marco);
}

// O aviso começa 1 dia antes de completar o marco.
export function dataAvisoExperiencia(dataAdmissao: string, marco: MarcoExperiencia): string {
  return somarDias(dataAdmissao, marco - 1);
}

export function chaveAvisoLido(funcionarioId: string, marco: MarcoExperiencia): string {
  return `${funcionarioId}:${marco}`;
}

// Avisos pendentes hoje: funcionário ativo (com admissão e sem rescisão) cujo
// dia de aviso já chegou e cujo marco ainda não foi marcado como lido. Não há
// limite superior de data: um aviso de 2 meses atrás continua aparecendo até
// ser lido.
export function avisosExperienciaPendentes(
  funcionarios: readonly FuncionarioExperiencia[],
  lidos: readonly AvisoLido[],
  hoje: string,
): AvisoExperiencia[] {
  const lidas = new Set(lidos.map((l) => chaveAvisoLido(l.funcionarioId, l.marco)));
  const avisos: AvisoExperiencia[] = [];
  for (const f of funcionarios) {
    const admissao = (f.dataAdmissao ?? "").trim();
    if (!DATA_ISO.test(admissao)) continue;
    if ((f.dataRescisao ?? "").trim()) continue;
    for (const marco of MARCOS_EXPERIENCIA) {
      if (lidas.has(chaveAvisoLido(f.id, marco))) continue;
      const dataAviso = dataAvisoExperiencia(admissao, marco);
      if (dataAviso > hoje) continue;
      avisos.push({
        funcionarioId: f.id,
        nome: f.nome,
        marco,
        dataMarco: dataMarcoExperiencia(admissao, marco),
        dataAviso,
      });
    }
  }
  return avisos.sort(
    (a, b) => a.dataMarco.localeCompare(b.dataMarco) || a.nome.localeCompare(b.nome),
  );
}

export function mensagemAvisoExperiencia(aviso: AvisoExperiencia, hoje: string): string {
  const etapa =
    aviso.marco === 45
      ? "os primeiros 45 dias de experiência"
      : "os 90 dias de experiência (prorrogação)";
  if (aviso.dataMarco > hoje) return `${aviso.nome} completa amanhã ${etapa}.`;
  if (aviso.dataMarco === hoje) return `${aviso.nome} completa hoje ${etapa}.`;
  return `${aviso.nome} já completou ${etapa}.`;
}
