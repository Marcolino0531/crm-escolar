// Regras de calendário da cobrança automática por WhatsApp.
//
// A automação NÃO dispara aos sábados, domingos nem feriados nacionais. Um
// disparo cujo dia-gatilho (vencimento + `offsetDias`) caia num desses dias é
// REAGENDADO para o próximo dia útil — nunca pulado nem acumulado atrasado.
//
// Toda a aritmética é feita sobre strings "YYYY-MM-DD" via `Date.UTC` (sem
// `new Date()` local), então o resultado independe do fuso do runtime da Vercel.
//
// ─── Como atualizar os feriados em anos futuros ──────────────────────────────
// Feriados FIXOS: edite `FERIADOS_FIXOS` abaixo (MM-DD). Feriados MÓVEIS
// (baseados na Páscoa) são calculados automaticamente por `calcularPascoa` para
// qualquer ano, então não precisam de manutenção manual.

// Feriados nacionais de data fixa (MM-DD). Base legal: Lei 662/1949 e alterações
// (incl. Lei 14.759/2023, que tornou 20/11 — Consciência Negra — feriado
// nacional a partir de 2024).
const FERIADOS_FIXOS: readonly string[] = [
  "01-01", // Confraternização Universal
  "04-21", // Tiradentes
  "05-01", // Dia do Trabalho
  "09-07", // Independência
  "10-12", // Nossa Senhora Aparecida
  "11-02", // Finados
  "11-15", // Proclamação da República
  "11-20", // Consciência Negra (nacional a partir de 2024)
  "12-25", // Natal
];

// Ano a partir do qual 20/11 (Consciência Negra) vale como feriado nacional.
const ANO_CONSCIENCIA_NEGRA = 2024;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Domingo de Páscoa (algoritmo de Meeus/Butcher/anonymous Gregorian) como
// componentes { mes, dia } do ano informado.
export function calcularPascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

// Feriados nacionais MÓVEIS derivados da Páscoa. Inclui os amplamente
// observados no país (Carnaval — segunda e terça, Sexta-feira Santa e Corpus
// Christi), relevantes para o calendário escolar/financeiro.
function feriadosMoveis(ano: number): string[] {
  const { mes, dia } = calcularPascoa(ano);
  const pascoa = `${ano}-${pad2(mes)}-${pad2(dia)}`;
  return [
    addDaysYMD(pascoa, -48), // Carnaval (segunda-feira)
    addDaysYMD(pascoa, -47), // Carnaval (terça-feira)
    addDaysYMD(pascoa, -2), // Sexta-feira Santa
    addDaysYMD(pascoa, 60), // Corpus Christi
  ];
}

const feriadosCache = new Map<number, Set<string>>();

// Conjunto de feriados nacionais (YYYY-MM-DD) de um ano, memoizado.
export function feriadosNacionais(ano: number): Set<string> {
  const cached = feriadosCache.get(ano);
  if (cached) return cached;
  const set = new Set<string>();
  for (const mmdd of FERIADOS_FIXOS) {
    if (mmdd === "11-20" && ano < ANO_CONSCIENCIA_NEGRA) continue;
    set.add(`${ano}-${mmdd}`);
  }
  for (const f of feriadosMoveis(ano)) set.add(f);
  feriadosCache.set(ano, set);
  return set;
}

export function isFeriadoNacional(ymd: string): boolean {
  const ano = Number(ymd.slice(0, 4));
  if (!ano) return false;
  return feriadosNacionais(ano).has(ymd);
}

// Dia da semana (0=domingo … 6=sábado) de "YYYY-MM-DD", timezone-safe.
export function diaSemanaYMD(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isFimDeSemana(ymd: string): boolean {
  const dow = diaSemanaYMD(ymd);
  return dow === 0 || dow === 6;
}

// Dia útil = não é sábado, domingo nem feriado nacional.
export function isDiaUtil(ymd: string): boolean {
  return !isFimDeSemana(ymd) && !isFeriadoNacional(ymd);
}

// "YYYY-MM-DD" deslocado por `n` dias (positivo ou negativo), timezone-safe.
export function addDaysYMD(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Próximo dia útil em `ymd` ou depois (retorna o próprio dia se já for útil).
export function proximoDiaUtil(ymd: string): string {
  let d = ymd;
  while (!isDiaUtil(d)) d = addDaysYMD(d, 1);
  return d;
}

// Vencimentos cujo disparo deve acontecer HOJE.
//
// O dia-gatilho de um vencimento V é `V + offsetDias`. Se esse gatilho cair em
// fim de semana/feriado, ele rola para o próximo dia útil. Portanto, num dia
// útil `hoje`, devem ser disparados todos os vencimentos cujo gatilho resolvido
// seja `hoje`: o gatilho == hoje E os gatilhos dos dias NÃO úteis imediatamente
// anteriores (que rolaram para cá). Se `hoje` não for dia útil, retorna vazio
// (envio pausado). Cada vencimento aparece no máximo uma vez → sem duplicidade.
export function vencimentosParaEnvio(
  hojeYMD: string,
  offsetDias = 2,
): { gatilho: string; vencimento: string }[] {
  if (!isDiaUtil(hojeYMD)) return [];
  const gatilhos: string[] = [hojeYMD];
  let anterior = addDaysYMD(hojeYMD, -1);
  while (!isDiaUtil(anterior)) {
    gatilhos.push(anterior);
    anterior = addDaysYMD(anterior, -1);
  }
  return gatilhos.map((gatilho) => ({ gatilho, vencimento: addDaysYMD(gatilho, -offsetDias) }));
}
