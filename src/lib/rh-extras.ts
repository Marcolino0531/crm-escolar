// RH > Pessoal > Extras: pessoas avulsas pagas em RH > Pagamentos > Salário.

export type Extra = {
  id: string;
  nomeCompleto: string;
  ativo: boolean;
  criadoEm: string;
  criadoPor: string;
};

// Chave de comparação do nome: sem acentos, minúsculo e com espaços simples.
export function chaveNomeExtra(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function nomeExtraNormalizado(nome: string): string {
  return nome.trim().replace(/\s+/g, " ");
}

// Já existe outro Extra ATIVO com o mesmo nome (sem diferenciar maiúsculas e acentos)?
export function nomeExtraDuplicado(
  extras: readonly { id: string; nomeCompleto: string; ativo: boolean }[],
  nome: string,
  ignorarId?: string,
): boolean {
  const k = chaveNomeExtra(nome);
  return extras.some((e) => e.ativo && e.id !== ignorarId && chaveNomeExtra(e.nomeCompleto) === k);
}

export const MENSAGEM_EXTRA_DUPLICADO = "Já existe um Extra ativo com este nome neste colégio.";
