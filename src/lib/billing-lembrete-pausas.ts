// Pausa manual, sem prazo, dos lembretes PREVENTIVOS (D-5/D-3/D-0) por número.
//
// Caso de uso: o responsável paga em dia e pede para não receber o aviso
// antecipado de vencimento. Só a régua de lembretes respeita esta lista; a
// cobrança de parcela vencida, o lembrete de rematrícula e qualquer outra
// mensagem automática seguem normalmente para o mesmo número.
//
// Diferente da pausa por comprovante (`billing-pauses`, 24h, cobrança E
// lembrete), aqui a pausa dura até alguém reativar o número.

import { chaveTelefone } from "./billing-recurrence";

export interface PausaLembrete {
  telefone: string;
}

export function chavesPausadas(pausas: readonly PausaLembrete[]): Set<string> {
  const set = new Set<string>();
  for (const p of pausas) {
    const k = chaveTelefone(p.telefone);
    if (k) set.add(k);
  }
  return set;
}

export function telefonePausado(telefone: string, chaves: ReadonlySet<string>): boolean {
  const k = chaveTelefone(telefone);
  return k !== "" && chaves.has(k);
}

// Aplicado às parcelas ANTES do agrupamento por responsável: o número pausado
// não entra em grupo nenhum, então não conta como tentativa nem gera registro.
export function filtrarPausadosLembrete<T extends { telefone: string }>(
  parcelas: readonly T[],
  pausas: readonly PausaLembrete[],
): T[] {
  const chaves = chavesPausadas(pausas);
  if (chaves.size === 0) return [...parcelas];
  return parcelas.filter((p) => !telefonePausado(p.telefone, chaves));
}

export type Candidato = {
  telefone: string;
  responsavel: string;
  alunos: string[];
  unidade: string;
};

export type LogBusca = {
  responsavel_name: string | null;
  aluno_name: string | null;
  telefone: string | null;
  unidade: string | null;
};

// Candidatos vêm do histórico de disparos (quem já recebeu cobrança/lembrete):
// um por telefone, juntando os alunos que aparecem para aquele número.
export function agruparCandidatos(logs: readonly LogBusca[]): Candidato[] {
  const porChave = new Map<string, Candidato>();
  for (const l of logs) {
    const tel = (l.telefone ?? "").trim();
    const chave = chaveTelefone(tel);
    if (!chave) continue;
    const atual = porChave.get(chave);
    const aluno = (l.aluno_name ?? "").trim();
    if (atual) {
      if (aluno && !atual.alunos.includes(aluno)) atual.alunos.push(aluno);
      if (!atual.responsavel && l.responsavel_name) atual.responsavel = l.responsavel_name.trim();
    } else {
      porChave.set(chave, {
        telefone: tel,
        responsavel: (l.responsavel_name ?? "").trim(),
        alunos: aluno ? [aluno] : [],
        unidade: (l.unidade ?? "").trim(),
      });
    }
  }
  return [...porChave.values()];
}
