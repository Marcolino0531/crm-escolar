// Regras puras da Biblioteca: atraso em dias úteis, multa com teto, bloqueio
// de novo empréstimo e agregados por aluno.
//
// Calendário: reaproveita isDiaUtilDespesa (fim de semana + feriado nacional +
// feriado municipal de BH) de fluxo-futuro-dia-util — não há calendário próprio.

import { addDaysYMD } from "./billing-schedule";
import { isDiaUtilDespesa } from "./fluxo-futuro-dia-util";

export const MULTA_POR_DIA_UTIL = 2;
export const MULTA_TETO = 30;
// Prazo padrão sugerido para a devolução (dias corridos), ajustado ao dia útil.
export const PRAZO_PADRAO_DIAS = 7;

export type StatusExemplar = "disponivel" | "emprestado" | "manutencao" | "perdido";

export const ROTULO_STATUS_EXEMPLAR: Record<StatusExemplar, string> = {
  disponivel: "Disponível",
  emprestado: "Emprestado",
  manutencao: "Em manutenção",
  perdido: "Perdido",
};

export interface EmprestimoBase {
  id: string;
  aluno_id: string;
  data_emprestimo: string;
  data_prevista: string;
  data_devolucao: string | null;
  perdido: boolean;
  dias_atraso: number;
  multa_valor: number;
  multa_paga_em: string | null;
}

// Dias ÚTEIS de atraso entre a data prevista e a devolução: conta cada dia
// útil em (prevista, devolucao]. Devolução em dia (ou antes) = 0.
export function diasUteisAtraso(dataPrevista: string, dataDevolucao: string): number {
  if (dataDevolucao <= dataPrevista) return 0;
  let dias = 0;
  let d = addDaysYMD(dataPrevista, 1);
  while (d <= dataDevolucao) {
    if (isDiaUtilDespesa(d)) dias++;
    d = addDaysYMD(d, 1);
  }
  return dias;
}

// R$2,00 por dia útil de atraso, teto de R$30,00 por empréstimo.
export function calcularMulta(diasUteis: number): number {
  if (diasUteis <= 0) return 0;
  return Math.min(MULTA_TETO, diasUteis * MULTA_POR_DIA_UTIL);
}

export interface ResultadoDevolucao {
  diasAtraso: number;
  multa: number;
}

export function calcularDevolucao(dataPrevista: string, dataDevolucao: string): ResultadoDevolucao {
  const diasAtraso = diasUteisAtraso(dataPrevista, dataDevolucao);
  return { diasAtraso, multa: calcularMulta(diasAtraso) };
}

// Data prevista sugerida: hoje + prazo padrão, empurrada para o próximo dia
// útil (ninguém devolve livro em sábado/feriado).
export function dataPrevistaSugerida(
  dataEmprestimo: string,
  prazoDias = PRAZO_PADRAO_DIAS,
): string {
  let d = addDaysYMD(dataEmprestimo, prazoDias);
  while (!isDiaUtilDespesa(d)) d = addDaysYMD(d, 1);
  return d;
}

export function emprestimoAberto(e: EmprestimoBase): boolean {
  return e.data_devolucao === null;
}

// Em atraso = aberto e já passou da data prevista.
export function emprestimoAtrasado(e: EmprestimoBase, hojeYMD: string): boolean {
  return emprestimoAberto(e) && hojeYMD > e.data_prevista;
}

export function multaEmAberto(e: EmprestimoBase): boolean {
  return e.multa_valor > 0 && e.multa_paga_em === null;
}

export function saldoMultasAberto(emprestimos: EmprestimoBase[]): number {
  return emprestimos.filter(multaEmAberto).reduce((s, e) => s + Number(e.multa_valor), 0);
}

export type MotivoBloqueio = "multa_aberta" | "emprestimo_atrasado" | "emprestimo_aberto";

export const ROTULO_BLOQUEIO: Record<MotivoBloqueio, string> = {
  multa_aberta: "Multa em aberto",
  emprestimo_atrasado: "Empréstimo em atraso",
  emprestimo_aberto: "Já possui um exemplar emprestado",
};

export interface PendenciasAluno {
  podeEmprestar: boolean;
  motivos: MotivoBloqueio[];
  emprestimoAberto: EmprestimoBase | null;
  saldoMultas: number;
}

// Pode pegar um livro novo? Só sem multa em aberto, sem empréstimo em atraso e
// sem nenhum empréstimo aberto (limite de 1 exemplar por aluno).
export function pendenciasDoAluno(
  emprestimosDoAluno: EmprestimoBase[],
  hojeYMD: string,
): PendenciasAluno {
  const motivos: MotivoBloqueio[] = [];
  const saldoMultas = saldoMultasAberto(emprestimosDoAluno);
  if (saldoMultas > 0) motivos.push("multa_aberta");

  const aberto = emprestimosDoAluno.find(emprestimoAberto) ?? null;
  if (aberto) {
    motivos.push(emprestimoAtrasado(aberto, hojeYMD) ? "emprestimo_atrasado" : "emprestimo_aberto");
  }

  return { podeEmprestar: motivos.length === 0, motivos, emprestimoAberto: aberto, saldoMultas };
}

// Exemplar pode sair? Só se estiver disponível.
export function exemplarPodeSerEmprestado(status: StatusExemplar): boolean {
  return status === "disponivel";
}

export function validarNovoEmprestimo(
  statusExemplar: StatusExemplar,
  emprestimosDoAluno: EmprestimoBase[],
  hojeYMD: string,
): { ok: true } | { ok: false; erro: string } {
  if (!exemplarPodeSerEmprestado(statusExemplar)) {
    return {
      ok: false,
      erro: `Exemplar ${ROTULO_STATUS_EXEMPLAR[statusExemplar].toLowerCase()} — não pode ser emprestado.`,
    };
  }
  const p = pendenciasDoAluno(emprestimosDoAluno, hojeYMD);
  if (!p.podeEmprestar) {
    return { ok: false, erro: p.motivos.map((m) => ROTULO_BLOQUEIO[m]).join("; ") + "." };
  }
  return { ok: true };
}

export interface ResumoAluno {
  aluno_id: string;
  aluno_nome: string;
  saldoMultas: number;
  emprestimosAtrasados: number;
  emprestimosAbertos: number;
}

// Agrega os empréstimos por aluno para a aba de pendências (só quem tem algo).
export function resumirPendencias<T extends EmprestimoBase & { aluno_nome: string }>(
  emprestimos: T[],
  hojeYMD: string,
): ResumoAluno[] {
  const porAluno = new Map<string, T[]>();
  for (const e of emprestimos) {
    const lista = porAluno.get(e.aluno_id) ?? [];
    lista.push(e);
    porAluno.set(e.aluno_id, lista);
  }
  const out: ResumoAluno[] = [];
  for (const [aluno_id, lista] of porAluno) {
    const r: ResumoAluno = {
      aluno_id,
      aluno_nome: lista[0].aluno_nome,
      saldoMultas: saldoMultasAberto(lista),
      emprestimosAtrasados: lista.filter((e) => emprestimoAtrasado(e, hojeYMD)).length,
      emprestimosAbertos: lista.filter(emprestimoAberto).length,
    };
    if (r.saldoMultas > 0 || r.emprestimosAtrasados > 0) out.push(r);
  }
  return out.sort((a, b) => a.aluno_nome.localeCompare(b.aluno_nome, "pt-BR"));
}

// Código lido pela câmera/etiqueta: só os dígitos (Code128 devolve o texto puro;
// QR pode vir com prefixo).
export function normalizarCodigoExemplar(texto: string): string {
  const digitos = texto.replace(/\D/g, "");
  return digitos.length === 12 ? digitos : "";
}

// "000000000042" → "0000 0000 0042" (leitura humana na etiqueta).
export function formatarCodigoExemplar(codigo: string): string {
  return codigo.replace(/(\d{4})(?=\d)/g, "$1 ");
}
