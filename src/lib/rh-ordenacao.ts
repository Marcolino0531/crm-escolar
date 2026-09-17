// Ordenação da lista de funcionários (abas Ativos/Desligados) por coluna.
//
// Lógica pura: valores vazios (CPF, Cargo ou Admissão em branco) vão sempre
// para o fim, independente da direção. Datas são ISO "YYYY-MM-DD", então a
// comparação textual coincide com a cronológica. Padrão: Nome A-Z.

export type ColunaOrdenacao =
  | "nome"
  | "cpf"
  | "cargo"
  | "admissao"
  | "rescisao"
  | "horario"
  | "status";

export type DirecaoOrdenacao = "asc" | "desc";

export type OrdenacaoRh = { coluna: ColunaOrdenacao; direcao: DirecaoOrdenacao };

export const ORDENACAO_PADRAO: OrdenacaoRh = { coluna: "nome", direcao: "asc" };

export type FuncionarioOrdenavel = {
  nomeCompleto: string;
  cpf?: string;
  cargo?: string;
  dataAdmissao?: string;
  dataRescisao?: string;
  horarioTrabalhoInicio?: string;
  horarioTrabalhoFim?: string;
};

const chave = (f: FuncionarioOrdenavel, coluna: ColunaOrdenacao): string => {
  switch (coluna) {
    case "nome":
      return f.nomeCompleto ?? "";
    case "cpf":
      return (f.cpf ?? "").replace(/\D/g, "");
    case "cargo":
      return f.cargo ?? "";
    case "admissao":
      return f.dataAdmissao ?? "";
    case "rescisao":
      return f.dataRescisao ?? "";
    case "horario":
      return f.horarioTrabalhoInicio
        ? `${f.horarioTrabalhoInicio} ${f.horarioTrabalhoFim ?? ""}`
        : "";
    case "status":
      return f.dataRescisao ? "Desligado" : "Ativo";
  }
};

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

// Clicar na mesma coluna inverte a direção; em outra coluna começa em "asc".
export function alternarOrdenacao(atual: OrdenacaoRh, coluna: ColunaOrdenacao): OrdenacaoRh {
  if (atual.coluna === coluna) {
    return { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" };
  }
  return { coluna, direcao: "asc" };
}

export function ordenarFuncionarios<T extends FuncionarioOrdenavel>(
  lista: readonly T[],
  ordenacao: OrdenacaoRh,
): T[] {
  const sinal = ordenacao.direcao === "asc" ? 1 : -1;
  return [...lista].sort((a, b) => {
    const ka = chave(a, ordenacao.coluna).trim();
    const kb = chave(b, ordenacao.coluna).trim();
    if (!ka && !kb) return collator.compare(a.nomeCompleto, b.nomeCompleto);
    if (!ka) return 1;
    if (!kb) return -1;
    const cmp = collator.compare(ka, kb);
    if (cmp !== 0) return cmp * sinal;
    return collator.compare(a.nomeCompleto, b.nomeCompleto);
  });
}
