// Lotes de pagamento de RH (hr_transport_batches): Vale-Transporte e Salário
// convivem na mesma tabela, diferenciados por `tipo`.
import { somaReais } from "./extrato-mensal";
import { toTitleCase } from "./name-format";
import { salarioVigente, type ItemValorMensal, type SalarioRegistro } from "./rh-salario";

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

// ── Lote de Salário em três blocos: Efetivos, Terceirizados e Extras ──
export type TipoPessoaLote = "efetivo" | "terceirizado" | "extra";

export const TIPOS_PESSOA_LOTE: readonly TipoPessoaLote[] = ["efetivo", "terceirizado", "extra"];

export const ROTULO_BLOCO: Record<TipoPessoaLote, string> = {
  efetivo: "Efetivos",
  terceirizado: "Terceirizados",
  extra: "Extras",
};

// Item sem tipo (folhas salvas antes dos blocos) é efetivo.
export function tipoPessoaLote(v: string | null | undefined): TipoPessoaLote {
  return v === "terceirizado" || v === "extra" ? v : "efetivo";
}

export type ItemLoteSalario = {
  tipo_pessoa: TipoPessoaLote;
  employee_id: string | null;
  pessoa_id: string | null;
  employee_name: string;
  total_amount: number;
};

export type LoteSalario = {
  itens: ItemLoteSalario[];
  subtotais: Record<TipoPessoaLote, number>;
  total: number;
};

// Junta aos efetivos (folha importada ou salário manual) os Terceirizados e
// Extras com valor a pagar; cada bloco em ordem alfabética pelo nome padronizado.
export function loteComValoresMensais(
  efetivos: readonly { employee_id: string; employee_name: string; total_amount: number }[],
  valoresMensais: readonly ItemValorMensal[],
): LoteSalario {
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
  const doTipo = (tipo: "terceirizado" | "extra"): ItemLoteSalario[] =>
    valoresMensais
      .filter((v) => v.tipo === tipo)
      .map((v) => ({
        tipo_pessoa: tipo,
        employee_id: null,
        pessoa_id: v.pessoaId,
        employee_name: toTitleCase(v.nome),
        total_amount: Math.round(v.valor * 100) / 100,
      }))
      .sort((a, b) => collator.compare(a.employee_name, b.employee_name));
  const itens: ItemLoteSalario[] = [
    ...efetivos.map((e) => ({
      tipo_pessoa: "efetivo" as const,
      employee_id: e.employee_id,
      pessoa_id: null,
      employee_name: e.employee_name,
      total_amount: e.total_amount,
    })),
    ...doTipo("terceirizado"),
    ...doTipo("extra"),
  ];
  const subtotal = (t: TipoPessoaLote) =>
    somaReais(itens.filter((i) => i.tipo_pessoa === t).map((i) => i.total_amount));
  const subtotais = {
    efetivo: subtotal("efetivo"),
    terceirizado: subtotal("terceirizado"),
    extra: subtotal("extra"),
  };
  return { itens, subtotais, total: somaReais(Object.values(subtotais)) };
}

// Detalhe de uma folha salva de Salário: itens nos três blocos (bloco vazio não
// aparece), mantendo a ordem recebida, com subtotal e total.
export function blocosDaFolhaSalva<T extends { tipo_pessoa?: string | null; total_amount: number }>(
  itens: readonly T[],
): { blocos: { tipo: TipoPessoaLote; itens: T[]; subtotal: number }[]; total: number } {
  const blocos = TIPOS_PESSOA_LOTE.map((tipo) => {
    const doBloco = itens.filter((i) => tipoPessoaLote(i.tipo_pessoa) === tipo);
    return {
      tipo,
      itens: doBloco,
      subtotal: somaReais(doBloco.map((i) => Number(i.total_amount))),
    };
  }).filter((b) => b.itens.length > 0);
  return { blocos, total: somaReais(blocos.map((b) => b.subtotal)) };
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
