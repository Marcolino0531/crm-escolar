import { describe, expect, it } from "vitest";
import {
  type AtividadeAvaliativa,
  type NotaRow,
  boletimDisciplina,
  mediaTrimestre,
  notaFinalAno,
  notaFinalTrimestre,
  notaTrimestre,
  precisaRecuperacaoFinal,
  segmentoDaTurma,
  somaAnual,
  validarAtividade,
  validarRecuperacaoTrimestre,
  valorDistribuido,
} from "./pedagogico-notas";

const chave = {
  school_id: "esc",
  ano_letivo: 2027,
  turma_nome: "12 - 6º Ano",
  disciplina_id: "mat",
};

const ativ = (
  id: string,
  trimestre: 1 | 2 | 3,
  valor: number,
  extra: Partial<AtividadeAvaliativa> = {},
): AtividadeAvaliativa => ({
  id,
  ...chave,
  professor_id: "prof",
  trimestre,
  nome: id,
  valor_maximo: valor,
  data: `2027-0${trimestre * 3}-10`,
  ...extra,
});

describe("atividades avaliativas — distribuição do trimestre", () => {
  const existentes = [ativ("p1", 1, 10), ativ("t1", 1, 12), ativ("p3", 3, 40)];

  it("soma só as atividades da mesma turma+disciplina+trimestre", () => {
    expect(valorDistribuido(existentes, chave, 1)).toBe(22);
    expect(valorDistribuido(existentes, chave, 2)).toBe(0);
    expect(valorDistribuido(existentes, chave, 3)).toBe(40);
    expect(valorDistribuido(existentes, { ...chave, disciplina_id: "port" }, 1)).toBe(0);
  });

  it("aceita completar exatamente o total e barra o que ultrapassa (30/30/40)", () => {
    expect(validarAtividade(existentes, ativ("p2", 1, 8))).toBeNull();
    expect(validarAtividade(existentes, ativ("p2", 1, 8.5))).toMatch(/máximo é 30/);
    expect(validarAtividade(existentes, ativ("x", 2, 30))).toBeNull();
    expect(validarAtividade(existentes, ativ("x", 2, 30.01))).toMatch(/máximo é 30/);
    expect(validarAtividade(existentes, ativ("x", 3, 0.5))).toMatch(/máximo é 40/);
  });

  it("ao editar, ignora o valor antigo da própria atividade", () => {
    expect(validarAtividade(existentes, ativ("t1", 1, 20))).toBeNull();
    expect(validarAtividade(existentes, ativ("t1", 1, 21))).toMatch(/máximo é 30/);
  });

  it("valor zero, nome vazio e data fora do ano são recusados", () => {
    expect(validarAtividade([], ativ("x", 1, 0))).toMatch(/maior que zero/);
    expect(validarAtividade([], ativ("x", 1, 5, { nome: " " }))).toMatch(/nome/);
    expect(validarAtividade([], ativ("x", 1, 5, { data: "2026-03-10" }))).toMatch(/ano letivo/);
  });
});

describe("nota do trimestre", () => {
  const ativs = [ativ("p1", 1, 10), ativ("t1", 1, 12), ativ("p2", 1, 8)];
  const notas: NotaRow[] = [
    { atividade_id: "p1", sponte_aluno_id: "a", nota: 7.5 },
    { atividade_id: "t1", sponte_aluno_id: "a", nota: 10 },
    { atividade_id: "p2", sponte_aluno_id: "a", nota: 6 },
    { atividade_id: "p1", sponte_aluno_id: "b", nota: 3 },
    { atividade_id: "outra", sponte_aluno_id: "a", nota: 99 },
  ];

  it("soma as notas do aluno nas atividades do trimestre; sem nota conta zero", () => {
    expect(notaTrimestre(ativs, notas, "a")).toBe(23.5);
    expect(notaTrimestre(ativs, notas, "b")).toBe(3);
    expect(notaTrimestre(ativs, notas, "c")).toBe(0);
  });

  it("média é 70% do valor do trimestre", () => {
    expect(mediaTrimestre(1)).toBe(21);
    expect(mediaTrimestre(2)).toBe(21);
    expect(mediaTrimestre(3)).toBe(28);
  });
});

describe("recuperação de trimestre", () => {
  it("abaixo de 21 com recuperação: fica com a maior das duas, limitada a 21", () => {
    expect(notaFinalTrimestre(1, 15, 18)).toBe(18);
    expect(notaFinalTrimestre(1, 15, 21)).toBe(21);
    expect(notaFinalTrimestre(2, 15, 30)).toBe(21);
    expect(notaFinalTrimestre(1, 20.5, 25)).toBe(21);
  });

  it("recuperação nunca reduz a nota", () => {
    expect(notaFinalTrimestre(1, 18, 10)).toBe(18);
    expect(notaFinalTrimestre(1, 18, 0)).toBe(18);
  });

  it("abaixo de 21 sem recuperação lançada mantém a nota", () => {
    expect(notaFinalTrimestre(1, 15, null)).toBe(15);
  });

  it("nota >= 21 não tem recuperação e não recebe teto", () => {
    expect(notaFinalTrimestre(1, 21, 30)).toBe(21);
    expect(notaFinalTrimestre(1, 27, 30)).toBe(27);
    expect(notaFinalTrimestre(2, 30, null)).toBe(30);
  });

  it("3º trimestre não tem recuperação própria: nota entra direto", () => {
    expect(notaFinalTrimestre(3, 15, 40)).toBe(15);
    expect(notaFinalTrimestre(3, 15, null)).toBe(15);
    expect(validarRecuperacaoTrimestre(3, 20)).toMatch(/3º trimestre/);
    expect(validarRecuperacaoTrimestre(1, 20)).toBeNull();
    expect(validarRecuperacaoTrimestre(1, 31)).toMatch(/passar de 30/);
  });
});

describe("soma anual e recuperação final", () => {
  it("soma anual = final 1º + final 2º + nota 3º", () => {
    expect(somaAnual(21, 25, 30)).toBe(76);
    expect(somaAnual(10.5, 10.25, 10)).toBe(30.75);
  });

  it("recuperação final só quando soma < 70", () => {
    expect(precisaRecuperacaoFinal(69.99)).toBe(true);
    expect(precisaRecuperacaoFinal(70)).toBe(false);
  });

  it("aprovado na recuperação final trava em 70, mesmo tirando mais", () => {
    expect(notaFinalAno(66, 70)).toBe(70);
    expect(notaFinalAno(66, 90)).toBe(70);
    expect(notaFinalAno(66, 100)).toBe(70);
  });

  it("reprovado na recuperação final mantém a soma original (não a nota da prova)", () => {
    expect(notaFinalAno(66, 50)).toBe(66);
    expect(notaFinalAno(66, 69.9)).toBe(66);
    expect(notaFinalAno(66, 0)).toBe(66);
  });

  it("soma >= 70 não tem recuperação final e não recebe teto", () => {
    expect(notaFinalAno(70, null)).toBe(70);
    expect(notaFinalAno(95, null)).toBe(95);
    expect(notaFinalAno(95, 10)).toBe(95);
  });

  it("soma < 70 sem recuperação final lançada mantém a soma", () => {
    expect(notaFinalAno(66, null)).toBe(66);
  });
});

describe("exemplo de conferência: 25 / 26 / 15 de 40", () => {
  const atividades = [ativ("p1", 1, 30), ativ("p2", 2, 30), ativ("p3", 3, 20), ativ("t3", 3, 20)];
  const notas: NotaRow[] = [
    { atividade_id: "p1", sponte_aluno_id: "a", nota: 25 },
    { atividade_id: "p2", sponte_aluno_id: "a", nota: 26 },
    { atividade_id: "p3", sponte_aluno_id: "a", nota: 10 },
    { atividade_id: "t3", sponte_aluno_id: "a", nota: 5 },
  ];

  it("soma 66 → precisa de recuperação final; nenhum trimestre com recuperação", () => {
    const b = boletimDisciplina(chave, "a", atividades, notas, [], []);
    expect(b.trimestres.map((t) => t.nota)).toEqual([25, 26, 15]);
    expect(b.trimestres.map((t) => t.notaFinal)).toEqual([25, 26, 15]);
    expect(b.trimestres.map((t) => t.podeRecuperar)).toEqual([false, false, false]);
    expect(b.somaAnual).toBe(66);
    expect(b.precisaRecuperacaoFinal).toBe(true);
    expect(b.recuperacaoFinal).toBeNull();
    expect(b.notaFinalAno).toBe(66);
    expect(b.situacao).toBe("recuperacao_final");
  });

  it("recuperação final 90 → nota final do ano 70 (trava)", () => {
    const b = boletimDisciplina(
      chave,
      "a",
      atividades,
      notas,
      [],
      [{ ...chave, sponte_aluno_id: "a", nota: 90 }],
    );
    expect(b.notaFinalAno).toBe(70);
    expect(b.situacao).toBe("aprovado_recuperacao");
  });

  it("recuperação final 50 → nota final do ano continua 66 (reprovado)", () => {
    const b = boletimDisciplina(
      chave,
      "a",
      atividades,
      notas,
      [],
      [{ ...chave, sponte_aluno_id: "a", nota: 50 }],
    );
    expect(b.notaFinalAno).toBe(66);
    expect(b.situacao).toBe("reprovado");
  });

  it("3º trimestre ainda aberto: soma < 70 fica 'em andamento', não pede recuperação final", () => {
    const b = boletimDisciplina(chave, "a", atividades.slice(0, 3), notas, [], []);
    expect(b.somaAnual).toBe(61);
    expect(b.situacao).toBe("em_andamento");
  });
});

describe("boletim com recuperação de trimestre", () => {
  const atividades = [ativ("p1", 1, 30), ativ("p2", 2, 30), ativ("p3", 3, 40)];
  const notas: NotaRow[] = [
    { atividade_id: "p1", sponte_aluno_id: "a", nota: 15 },
    { atividade_id: "p2", sponte_aluno_id: "a", nota: 22 },
    { atividade_id: "p3", sponte_aluno_id: "a", nota: 30 },
  ];

  it("1º abaixo da média pode recuperar; recuperação 28 vira 21 na soma", () => {
    const sem = boletimDisciplina(chave, "a", atividades, notas, [], []);
    expect(sem.trimestres[0].podeRecuperar).toBe(true);
    expect(sem.trimestres[1].podeRecuperar).toBe(false);
    expect(sem.somaAnual).toBe(67);

    const com = boletimDisciplina(
      chave,
      "a",
      atividades,
      notas,
      [{ ...chave, trimestre: 1, sponte_aluno_id: "a", nota: 28 }],
      [],
    );
    expect(com.trimestres[0].recuperacao).toBe(28);
    expect(com.trimestres[0].notaFinal).toBe(21);
    expect(com.somaAnual).toBe(73);
    expect(com.situacao).toBe("aprovado");
    expect(com.notaFinalAno).toBe(73);
  });
});

describe("segmentoDaTurma — nomes reais das turmas do Sponte nas 4 unidades", () => {
  it.each([
    ["05 - 1º Período T / A / Prof. Kelly Declie", "infantil"],
    ["06 - 2º Período T / EMEI 1", "infantil"],
    ["01 - Berçário 1", "infantil"],
    ["01 - Berçário I", "infantil"],
    ["01 - Berçário II", "infantil"],
    ["02 - Maternal 1 T / A / Prof. Fernanda Kelly", "infantil"],
    ["04 - Maternal 3 M / Prof. Livia Kescia", "infantil"],
    ["02 - Maternal 1 / Manhã", "infantil"],
    ["05 - 1º Período / Tarde", "infantil"],
    ["04 - Maternal 3 T", "infantil"],
    ["07 - 1º Ano M / Prof. Priscilla Miranda", "fundamental"],
    ["07 - 1º Ano T / A Prof. Priscilla Miranda", "fundamental"],
    ["07 - 1º Ano T / EMEI 1", "fundamental"],
    ["11 - 5º Ano / Prof. Claudia Santos", "fundamental"],
    ["12 - 6º Ano", "fundamental"],
    ["15 - 9º Ano", "fundamental"],
    ["09 - 4º Ano / Tarde", "fundamental"],
    ["11 - 5º Ano T", "fundamental"],
  ])("%s → %s", (turma, esperado) => {
    expect(segmentoDaTurma(turma)).toBe(esperado);
  });

  it("turma sem série conhecida não é presumida", () => {
    expect(segmentoDaTurma("Turma Especial")).toBeNull();
    expect(segmentoDaTurma("")).toBeNull();
  });
});
