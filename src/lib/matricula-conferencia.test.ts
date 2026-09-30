import { describe, expect, it } from "vitest";
import {
  MENSAGEM_CONFERIDO,
  conferirCobrancas,
  conferirTurma,
  itemAceito,
  montarEsperadoConferencia,
  montarResultadoConferencia,
  type ItemConferido,
  type ParcelaSponte,
  type TipoConferencia,
} from "./matricula-conferencia";

// Stella (Belvedere, AlunoID 711): envio de 29/09/2026, ano letivo 2026,
// horário estendido e sem refeições. Matrícula e Material ficaram pendentes
// no envio; Mensalidade e Hora Extra foram planejadas pelo School Hub.
const esperadoStella = montarEsperadoConferencia({
  anoLetivo: 2026,
  dataPreenchimento: "2026-09-29",
  rotina: { semRefeicoes: true, refeicoes: {}, horarioEstendido: true },
  lancamentos: [
    {
      tipo: "matricula",
      parcelas: null,
      valor_parcela: null,
      valor_primeira_parcela: null,
      total: null,
      primeiro_vencimento: null,
      status: "pendente",
    },
    {
      tipo: "mensalidade",
      parcelas: 3,
      valor_parcela: 1138,
      valor_primeira_parcela: 477.23,
      total: 2753.23,
      primeiro_vencimento: "2026-10-19",
      status: "lancado",
    },
    {
      tipo: "hora_extra",
      parcelas: 3,
      valor_parcela: 500,
      valor_primeira_parcela: 500,
      total: 1500,
      primeiro_vencimento: "2026-10-19",
      status: "lancado",
    },
  ],
});

function parcela(categoria: string, vencimento: string, valor: number, id: string): ParcelaSponte {
  return {
    contaReceberId: id,
    numeroParcela: "1",
    vencimento,
    categoria,
    valor,
    situacao: "Pendente",
  };
}

const sponteStella: ParcelaSponte[] = [
  parcela("Mensalidade", "2026-11-05", 2623.4, "m1"),
  parcela("Mensalidade", "2026-12-07", 2623.4, "m2"),
  parcela("Hora Extra", "2026-11-05", 1020.15, "h1"),
  parcela("Hora Extra", "2026-12-07", 1020.15, "h2"),
  // Fora do ano letivo do envio: não conta.
  parcela("Material Pedagógico", "2025-03-05", 300, "x1"),
  parcela("Matrícula", "2025-12-05", 900, "x2"),
];

const turmaOk = conferirTurma({
  serie: "Maternal 3",
  anoLetivo: 2026,
  matriculas: [{ contratoId: 55, turmaId: 10, turma: "04 - Maternal 3 T", situacao: "Vigente" }],
  turmasDoAno: [
    {
      turmaId: 10,
      nome: "04 - Maternal 3 T",
      cursoId: 4,
      curso: "Maternal 3",
      anoLetivo: 2026,
      situacao: "Aberta",
      horario: "",
      maxAlunos: null,
      vagasOcupadas: null,
    },
  ],
  cursos: [{ cursoId: 4, nome: "04 - Maternal 3", serie: "Maternal 3" }],
});

function porTipo(itens: ItemConferido[]): Record<TipoConferencia, ItemConferido> {
  return Object.fromEntries(itens.map((i) => [i.tipo, i])) as Record<
    TipoConferencia,
    ItemConferido
  >;
}

describe("conferência da matrícula no Sponte", () => {
  it("a) caso Stella: Matrícula e Material faltando; Mensalidade e Hora Extra ok com aviso", () => {
    expect(esperadoStella.map((e) => e.tipo)).toEqual([
      "matricula",
      "mensalidade",
      "material",
      "hora_extra",
    ]);
    const itens = porTipo(conferirCobrancas(esperadoStella, sponteStella));

    expect(itens.matricula.situacao).toBe("faltando");
    expect(itens.material.situacao).toBe("faltando");

    expect(itens.mensalidade.situacao).toBe("aviso");
    expect(itemAceito(itens.mensalidade)).toBe(true);
    expect(itens.mensalidade.encontrado).toMatchObject({ parcelas: 2, total: 5246.8 });
    expect(itens.mensalidade.avisos.join(" ")).toContain("esperado 3x, encontrado 2x");

    expect(itens.hora_extra.situacao).toBe("aviso");
    expect(itemAceito(itens.hora_extra)).toBe(true);
    expect(itens.hora_extra.encontrado).toMatchObject({ parcelas: 2, total: 2040.3 });

    const resultado = montarResultadoConferencia({
      turma: turmaOk,
      itens: Object.values(itens),
      verificadoEm: "2026-09-30T12:00:00Z",
      verificadoPor: "Sérgio",
    });
    expect(resultado.fixavel).toBe(false);
    expect(resultado.faltando).toHaveLength(2);
    expect(resultado.faltando[0]).toContain("Matrícula");
    expect(resultado.faltando[1]).toContain("Material Pedagógico");
  });

  it("b) Matrícula encontrada e Material dispensado: tudo aceito, fixa", () => {
    const itens = conferirCobrancas(
      esperadoStella,
      [...sponteStella, parcela("Matrícula", "2026-10-05", 900, "mt1")],
      { material: "série sem material" },
    );
    const t = porTipo(itens);
    expect(t.matricula.situacao).toBe("aviso"); // sem plano no envio para comparar
    expect(t.material.situacao).toBe("dispensado");
    expect(t.material.motivoDispensa).toBe("série sem material");

    const resultado = montarResultadoConferencia({
      turma: turmaOk,
      itens,
      verificadoEm: "2026-09-30T12:00:00Z",
      verificadoPor: "Sérgio",
    });
    expect(resultado.fixavel).toBe(true);
    expect(resultado.faltando).toEqual([]);
    expect(MENSAGEM_CONFERIDO).toBe("Conferido: turma e cobranças de acordo com o Sponte.");
  });

  it("dispensa com motivo em branco não dispensa", () => {
    const t = porTipo(conferirCobrancas(esperadoStella, sponteStella, { material: "   " }));
    expect(t.material.situacao).toBe("faltando");
  });

  it("c) valor diferente do plano: ok com aviso, não impede fixar", () => {
    const esperado = montarEsperadoConferencia({
      anoLetivo: 2027,
      dataPreenchimento: "2026-10-01",
      rotina: null,
      lancamentos: [
        {
          tipo: "mensalidade",
          parcelas: 2,
          valor_parcela: 1000,
          valor_primeira_parcela: 1000,
          total: 2000,
          primeiro_vencimento: "2027-02-05",
          status: "lancado",
        },
      ],
    }).filter((e) => e.tipo === "mensalidade");
    const itens = conferirCobrancas(esperado, [
      parcela("Mensalidade", "2027-02-05", 1100, "a"),
      parcela("Mensalidade", "2027-03-05", 1100, "b"),
    ]);
    expect(itens[0].situacao).toBe("aviso");
    expect(itens[0].avisos).toHaveLength(1);
    expect(itens[0].avisos[0]).toContain("Valor");
    const resultado = montarResultadoConferencia({
      turma: { ...turmaOk, anoLetivo: 2027 },
      itens,
      verificadoEm: "2026-10-02T12:00:00Z",
      verificadoPor: "Sérgio",
    });
    expect(resultado.fixavel).toBe(true);
  });

  it("Matrícula só conta com vencimento do preenchimento até 31/01 do ano letivo", () => {
    const esperado = montarEsperadoConferencia({
      anoLetivo: 2027,
      dataPreenchimento: "2026-10-01",
      rotina: null,
      lancamentos: [],
    }).filter((e) => e.tipo === "matricula");
    expect(esperado[0].janela).toEqual({ de: "2026-10-01", ate: "2027-01-31" });
    const fora = conferirCobrancas(esperado, [parcela("Matrícula", "2027-02-05", 900, "a")]);
    expect(fora[0].situacao).toBe("faltando");
    const dentro = conferirCobrancas(esperado, [parcela("Matricula", "2026-11-05", 900, "a")]);
    expect(dentro[0].situacao).toBe("aviso");
  });

  it("turma sem contrato vigente da série e do ano: mensagem exata", () => {
    const t = conferirTurma({
      serie: "1º Período",
      anoLetivo: 2027,
      matriculas: [
        { contratoId: 55, turmaId: 10, turma: "04 - Maternal 3 T", situacao: "Vigente" },
      ],
      turmasDoAno: [],
      cursos: [],
    });
    expect(t.ok).toBe(false);
    expect(t.mensagem).toBe("Turma não encontrada no Sponte para 1º Período 2027");
    expect(turmaOk).toMatchObject({ ok: true, turmaNome: "04 - Maternal 3 T", turmaId: 10 });
  });
});
