// Lotes de pagamento de RH (hr_transport_batches): Vale-Transporte e Salário
// convivem na mesma tabela, diferenciados por `tipo`.
import { salarioVigente, type SalarioRegistro } from "./rh-salario";

export type TipoLote = "vt" | "salario";

export const ROTULO_TIPO_LOTE: Record<TipoLote, string> = {
  vt: "Vale Transporte",
  salario: "Salário",
};

export function tipoLote(v: string | null | undefined): TipoLote {
  return v === "salario" ? "salario" : "vt";
}

export type FuncionarioFolha = {
  id: string;
  nomeCompleto: string;
  dataRescisao?: string;
};

export type ItemFolhaSalario = {
  employee_id: string;
  employee_name: string;
  total_amount: number;
};

export type FolhaSalario = {
  itens: ItemFolhaSalario[];
  total: number;
  // Ativos sem nenhum salário vigente na competência (ficam fora do lote).
  semSalario: string[];
};

// Monta a folha de Salário da competência: um item por funcionário ativo com
// salário vigente (líquido quando informado, senão bruto), ordenado por nome.
export function montarFolhaSalario<T extends FuncionarioFolha>(
  funcionarios: readonly T[],
  registros: readonly SalarioRegistro[],
  competencia: string,
): FolhaSalario {
  const itens: ItemFolhaSalario[] = [];
  const semSalario: string[] = [];
  for (const f of funcionarios) {
    if (f.dataRescisao) continue;
    const v = salarioVigente(registros, f.id, competencia);
    const valor = v ? (v.valorLiquido ?? v.valor) : null;
    if (valor == null || valor <= 0) {
      semSalario.push(f.nomeCompleto);
      continue;
    }
    itens.push({
      employee_id: f.id,
      employee_name: f.nomeCompleto,
      total_amount: Math.round(valor * 100) / 100,
    });
  }
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
  itens.sort((a, b) => collator.compare(a.employee_name, b.employee_name));
  semSalario.sort(collator.compare);
  const total = Math.round(itens.reduce((acc, i) => acc + i.total_amount, 0) * 100) / 100;
  return { itens, total, semSalario };
}

export type PermissoesLotes = {
  podeEditarRh: boolean;
  podeVerSalario: boolean;
  podeEditarSalario: boolean;
};

// Quem pode ver um lote na listagem (a RLS garante no banco; aqui é a UI).
export function podeVerLote(tipo: TipoLote, p: PermissoesLotes): boolean {
  return tipo === "salario" ? p.podeVerSalario : true;
}

// Quem pode renomear/excluir o lote e alternar "quitado" dos itens.
export function podeEditarLote(tipo: TipoLote, p: PermissoesLotes): boolean {
  return tipo === "salario" ? p.podeEditarSalario : p.podeEditarRh;
}

export type ContagemQuitados = { pagos: number; total: number; quitado: boolean };

export function contagemQuitados(itens: readonly { is_paid: boolean }[]): ContagemQuitados {
  const pagos = itens.filter((i) => i.is_paid).length;
  return { pagos, total: itens.length, quitado: itens.length > 0 && pagos === itens.length };
}
