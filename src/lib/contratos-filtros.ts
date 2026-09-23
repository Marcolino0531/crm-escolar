// Filtros da aba Matrícula > Contratos (busca, turma e status). Lógica pura,
// sem acesso a dados: recebe os itens já restritos pelo seletor global.

import { TURMAS_POR_IDADE } from "./crm/mecCutoff";
import { chaveSerie } from "./rematricula";

/** Minúsculas e sem acentos: "Cecília" -> "cecilia". */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Chaves na ordem exibida no seletor; os rótulos são exatamente os selos da coluna Status.
export const STATUS_CONTRATO_ORDEM = [
  "pendente",
  "gerando",
  "erro",
  "aguardando",
  "assinado",
  "cancelado",
  "expirado",
] as const;
export type StatusContratoFiltro = (typeof STATUS_CONTRATO_ORDEM)[number];

export const STATUS_CONTRATO_LABEL: Record<StatusContratoFiltro, string> = {
  pendente: "Pendente de contrato",
  gerando: "Gerando",
  erro: "Erro na geração",
  aguardando: "Aguardando assinatura",
  assinado: "Assinado",
  cancelado: "Cancelado",
  expirado: "Expirado",
};

export interface ContratoFiltravel {
  alunoNome: string;
  alunoId: string;
  serie: string;
  contrato: {
    status: string;
    responsavelNome: string;
    zapsign: { status: string } | null;
  } | null;
}

/**
 * Mapeia o par (status local, status ZapSign) para o selo exibido. Contrato
 * "enviado" ainda sem documento ZapSign conta como aguardando assinatura.
 */
export function statusContratoFiltro(item: ContratoFiltravel): StatusContratoFiltro {
  const c = item.contrato;
  if (!c) return "pendente";
  if (c.status === "gerando") return "gerando";
  if (c.status === "erro") return "erro";
  if (c.status === "cancelado") return "cancelado";
  const z = c.zapsign?.status;
  if (z === "signed") return "assinado";
  if (z === "refused") return "cancelado";
  if (z === "expired") return "expirado";
  return "aguardando";
}

/** Turmas presentes nos itens, na ordem natural das séries (mesma tabela do MEC). */
export function turmasDosContratos(itens: readonly ContratoFiltravel[]): string[] {
  const turmas = new Set<string>();
  for (const i of itens) if (i.serie) turmas.add(i.serie);
  const indice = (s: string) => {
    const k = chaveSerie(s);
    const i = TURMAS_POR_IDADE.findIndex((t) => chaveSerie(t) === k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...turmas].sort((a, b) => indice(a) - indice(b) || a.localeCompare(b, "pt-BR"));
}

export function filtrarContratos<T extends ContratoFiltravel>(
  itens: readonly T[],
  filtros: { busca: string; turma: string | null; status: StatusContratoFiltro | null },
): T[] {
  const q = normalizarBusca(filtros.busca);
  return itens.filter((i) => {
    if (filtros.turma && i.serie !== filtros.turma) return false;
    if (filtros.status && statusContratoFiltro(i) !== filtros.status) return false;
    if (!q) return true;
    return (
      normalizarBusca(i.alunoNome).includes(q) ||
      i.alunoId.includes(q) ||
      normalizarBusca(i.contrato?.responsavelNome ?? "").includes(q)
    );
  });
}
