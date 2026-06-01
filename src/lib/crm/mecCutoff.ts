const TURMA_MAP: Record<number, string> = {
  0: "Berçário",
  1: "Maternal 1",
  2: "Maternal 2",
  3: "Maternal 3",
  4: "1º Período",
  5: "2º Período",
  6: "1º Ano",
  7: "2º Ano",
  8: "3º Ano",
  9: "4º Ano",
  10: "5º Ano",
  11: "6º Ano",
  12: "7º Ano",
  13: "8º Ano",
  14: "9º Ano",
};

export function calcularIdadeEscolar(dataNascimento: string): {
  idade: number;
  turma: string;
} {
  const nascimento = new Date(dataNascimento + "T00:00:00");
  const anoAtual = new Date().getFullYear();
  const dataCorte = new Date(anoAtual, 2, 31); // 31 de Março do ano atual

  let idade = dataCorte.getFullYear() - nascimento.getFullYear();

  const mesNasc = nascimento.getMonth();
  const diaNasc = nascimento.getDate();

  // Se a criança ainda não completou anos até 31/03
  if (mesNasc > 2 || (mesNasc === 2 && diaNasc > 31)) {
    idade--;
  }

  if (idade < 0) idade = 0;

  const turma = TURMA_MAP[idade] || "9º Ano";

  return { idade, turma };
}
