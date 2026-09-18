// Aniversariantes do mês (RH). Lógica pura sobre o cadastro de funcionários:
// só colaboradores ativos (sem rescisão) com data de nascimento ISO
// ("YYYY-MM-DD") válida; ordenação pelo dia do mês, nunca pelo ano.

export type FuncionarioAniversario = {
  id: string;
  nomeCompleto: string;
  cargo?: string;
  dataNascimento?: string;
  dataRescisao?: string;
};

export type Aniversariante = {
  id: string;
  nome: string;
  cargo: string;
  dia: number;
  mes: number;
  // "DD/MM"
  data: string;
};

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

export function mesAtual(hoje: Date = new Date()): number {
  return hoje.getMonth() + 1;
}

export function aniversariantesDoMes<T extends FuncionarioAniversario>(
  funcionarios: readonly T[],
  mes: number,
): Aniversariante[] {
  const lista: Aniversariante[] = [];
  for (const f of funcionarios) {
    if (f.dataRescisao) continue;
    const m = RE_ISO.exec(f.dataNascimento ?? "");
    if (!m) continue;
    const mesNasc = Number(m[2]);
    const dia = Number(m[3]);
    if (mesNasc !== mes || dia < 1 || dia > 31) continue;
    lista.push({
      id: f.id,
      nome: f.nomeCompleto,
      cargo: f.cargo ?? "",
      dia,
      mes: mesNasc,
      data: `${m[3]}/${m[2]}`,
    });
  }
  return lista.sort((a, b) => a.dia - b.dia || a.nome.localeCompare(b.nome, "pt-BR"));
}
