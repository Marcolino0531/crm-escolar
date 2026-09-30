// Regras puras do nome do aluno nas submissões do formulário de matrícula: o
// nome exibido acompanha o cadastro do Sponte, e o nome digitado pela família
// continua disponível para a busca e para a ficha.

export function normalizarNome(nome: string | null | undefined): string {
  return (nome ?? "").replace(/\s+/g, " ").trim();
}

// Nome a gravar em aluno_nome quando o Sponte traz um nome diferente do gravado;
// null quando não há o que mudar (Sponte sem nome ou nomes iguais).
export function nomeAtualizado(
  gravado: string | null | undefined,
  sponte: string | null | undefined,
): string | null {
  const novo = normalizarNome(sponte);
  if (!novo) return null;
  return novo === normalizarNome(gravado) ? null : novo;
}

// Nome digitado no formulário, quando for diferente do nome atual.
export function nomeInformadoDiferente(
  atual: string | null | undefined,
  formulario: string | null | undefined,
): string | null {
  const original = normalizarNome(formulario);
  if (!original) return null;
  return original === normalizarNome(atual) ? null : original;
}
