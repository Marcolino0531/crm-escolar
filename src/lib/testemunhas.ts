// Testemunhas de Documentos: duas pessoas por unidade que assinam o Contrato de
// Matrícula, o Termo de Confissão de Dívida e documentos avulsos da ZapSign.
// Cadastro em Configurações; leitores filtram sempre pela unidade do documento.

import { UNIDADES } from "@/lib/colegios";

export interface TestemunhaDocumento {
  unidade: string;
  ordem: number;
  nome: string;
  cpf: string;
  email: string;
  celular: string;
  ativa: boolean;
}

/** Testemunhas ativas de uma unidade, na ordem em que assinam. */
export function testemunhasDaUnidade<T extends TestemunhaDocumento>(
  linhas: readonly T[],
  unidade: string,
): T[] {
  return linhas.filter((t) => t.ativa && t.unidade === unidade).sort((a, b) => a.ordem - b.ordem);
}

/**
 * Espelha o backfill da migration: linhas globais (unidade vazia) ficam com a
 * primeira unidade e cada outra unidade recebe uma cópia das ativas, sem
 * duplicar ordem já ocupada.
 */
export function backfillTestemunhasPorUnidade<T extends TestemunhaDocumento>(
  linhas: readonly T[],
  unidades: readonly string[] = UNIDADES,
): T[] {
  const [principal, ...demais] = unidades;
  const base = linhas.map((t) => (t.unidade === "" ? { ...t, unidade: principal } : t));
  const copias: T[] = [];
  for (const u of demais) {
    for (const t of base) {
      if (t.unidade !== principal || !t.ativa) continue;
      const ocupada = [...base, ...copias].some(
        (x) => x.unidade === u && x.ordem === t.ordem && x.ativa,
      );
      if (!ocupada) copias.push({ ...t, unidade: u });
    }
  }
  return [...base, ...copias];
}
