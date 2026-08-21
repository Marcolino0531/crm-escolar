import { describe, expect, it } from "vitest";

import {
  agruparLembretesPorResponsavel,
  etiquetaPrazo,
  filtrarPorPrioridadeCobranca,
  lembretesEnviaveis,
  prazoDoVencimento,
  rotuloPrazo,
  vencimentoAlvo,
  vencimentosLembreteHoje,
  type ParcelaLembrete,
} from "./billing-reminders";
import { isDiaUtil } from "./billing-schedule";
import { jaCobradoHoje } from "./billing-recurrence";

// Caso real da Lara: o Sponte devolve as duas parcelas no MESMO NumeroBoleto
// (18322), mas com vencimentos diferentes — material em 05/08 e mensalidade em
// 17/08. Cada uma tem que gerar o lembrete pelo seu próprio vencimento.
function parcela(over: Partial<ParcelaLembrete> = {}): ParcelaLembrete {
  return {
    alunoId: "543",
    alunoNome: "Lara Mena Barreto Pereira",
    unidade: "CEC",
    telefone: "(31) 98823-0304",
    responsavelNome: "Danielle Mena Barreto Oliveira",
    vencimento: "2026-08-17",
    saldo: 1936.7,
    linhaDigitavel: "03399.86012 12345.678901 23456.789012 3 98760000193670",
    ...over,
  };
}

describe("prazo de cada lembrete a partir do vencimento real", () => {
  it("dispara D-5 quando a parcela vence em 5 dias", () => {
    expect(vencimentoAlvo("2026-08-12", 5)).toBe("2026-08-17");
    expect(prazoDoVencimento("2026-08-17", "2026-08-12")).toBe(5);
  });

  it("dispara D-3 quando a parcela vence em 3 dias", () => {
    expect(prazoDoVencimento("2026-08-17", "2026-08-14")).toBe(3);
  });

  it("dispara D-0 no próprio dia do vencimento", () => {
    expect(prazoDoVencimento("2026-08-17", "2026-08-17")).toBe(0);
  });

  it("não dispara em prazos que não são D-5, D-3 nem D-0", () => {
    for (const hoje of ["2026-08-11", "2026-08-13", "2026-08-15", "2026-08-16"]) {
      expect(prazoDoVencimento("2026-08-17", hoje)).toBeNull();
    }
  });

  it("não dispara depois do vencimento (aí é caso da cobrança automática)", () => {
    expect(prazoDoVencimento("2026-08-17", "2026-08-18")).toBeNull();
  });

  it("atravessa a virada de mês pelo calendário, não por aritmética de dia", () => {
    expect(vencimentoAlvo("2026-08-29", 5)).toBe("2026-09-03");
    expect(prazoDoVencimento("2026-09-01", "2026-08-29")).toBe(3);
  });

  it("consulta os três vencimentos do dia, do mais urgente ao menos", () => {
    expect(vencimentosLembreteHoje("2026-08-17")).toEqual([
      { prazo: 0, venc: "2026-08-17" },
      { prazo: 3, venc: "2026-08-20" },
      { prazo: 5, venc: "2026-08-22" },
    ]);
  });

  it("usa o texto aprovado do template na variável de prazo", () => {
    expect(rotuloPrazo(5)).toBe("em 5 dias");
    expect(rotuloPrazo(3)).toBe("em 3 dias");
    expect(rotuloPrazo(0)).toBe("hoje");
    expect(etiquetaPrazo(0)).toBe("D-0");
  });
});

describe("parcelas do mesmo boleto com vencimentos diferentes", () => {
  const material = parcela({ vencimento: "2026-08-05", saldo: 431.63 });
  const mensalidade = parcela({ vencimento: "2026-08-17", saldo: 1936.7 });

  it("lembra o material em D-3 sem antecipar a mensalidade do mesmo boleto", () => {
    const enviaveis = lembretesEnviaveis([material, mensalidade], "2026-08-02");
    expect(enviaveis).toHaveLength(1);
    expect(enviaveis[0].vencimento).toBe("2026-08-05");
  });

  it("lembra a mensalidade no dia dela, quando o material já passou", () => {
    const enviaveis = lembretesEnviaveis([material, mensalidade], "2026-08-17");
    expect(enviaveis).toHaveLength(1);
    expect(enviaveis[0].saldo).toBe(1936.7);
  });
});

describe("parcela quitada antes do prazo", () => {
  it("não gera lembrete quando o Sponte já registrou o pagamento", () => {
    const quitada = parcela({ dataPagamento: "2026-08-14" });
    expect(lembretesEnviaveis([quitada], "2026-08-17")).toEqual([]);
  });

  it("não gera lembrete quando o saldo foi zerado", () => {
    expect(lembretesEnviaveis([parcela({ saldo: 0 })], "2026-08-17")).toEqual([]);
  });

  it("segue lembrando a parcela que continua em aberto do mesmo responsável", () => {
    const paga = parcela({ alunoId: "543", saldo: 0 });
    const aberta = parcela({ alunoId: "544", alunoNome: "Irmão da Lara", saldo: 408.98 });
    const grupos = agruparLembretesPorResponsavel([paga, aberta], "2026-08-17");
    expect(grupos).toHaveLength(1);
    expect(grupos[0].valorTotal).toBe(408.98);
    expect(grupos[0].alunoIds).toEqual(["544"]);
  });
});

describe("um lembrete por responsável por dia", () => {
  it("junta os alunos do mesmo responsável em um único disparo", () => {
    const a = parcela({ alunoId: "543", alunoNome: "Lara", saldo: 1000 });
    const b = parcela({ alunoId: "544", alunoNome: "Pedro", saldo: 500 });
    const grupos = agruparLembretesPorResponsavel([a, b], "2026-08-17");
    expect(grupos).toHaveLength(1);
    expect(grupos[0].alunosLabel).toBe("Lara e Pedro");
    expect(grupos[0].valorTotal).toBe(1500);
    expect(grupos[0].prazo).toBe(0);
  });

  it("mantém apenas o prazo mais urgente quando o dia tem D-5 e D-0", () => {
    const hoje = parcela({ vencimento: "2026-08-17", saldo: 300 });
    const emCinco = parcela({ vencimento: "2026-08-22", saldo: 900 });
    const grupos = agruparLembretesPorResponsavel([emCinco, hoje], "2026-08-17");
    expect(grupos).toHaveLength(1);
    expect(grupos[0].prazo).toBe(0);
    expect(grupos[0].valorTotal).toBe(300);
    expect(grupos[0].vencimento).toBe("2026-08-17");
  });

  it("separa responsáveis diferentes", () => {
    const outra = parcela({ telefone: "(31) 99999-1111", responsavelNome: "Outra Mãe" });
    const grupos = agruparLembretesPorResponsavel([parcela(), outra], "2026-08-17");
    expect(grupos).toHaveLength(2);
  });

  it("usa a linha digitável disponível do grupo", () => {
    const semLinha = parcela({ alunoId: "544", linhaDigitavel: "" });
    const grupos = agruparLembretesPorResponsavel([semLinha, parcela()], "2026-08-17");
    expect(grupos[0].linhaDigitavel).not.toBe("");
  });

  it("com um único boleto, envia só a linha digitável dele (formato atual)", () => {
    const grupos = agruparLembretesPorResponsavel([parcela({ saldo: 180 })], "2026-08-17");
    expect(grupos[0].linhaDigitavel).toBe(parcela().linhaDigitavel);
  });

  // Caso real da Taciana: dois filhos, R$ 180,00 + R$ 100,00 = R$ 280,00. Antes a
  // mensagem levava o total certo mas só a linha digitável do boleto de 180.
  it("com irmãos agrupados, envia a linha digitável de CADA boleto com aluno e valor", () => {
    const heitor = parcela({
      alunoId: "486",
      alunoNome: "Heitor Cordeiro Borges",
      saldo: 180,
      linhaDigitavel: "11111.11111 11111.111111 11111.111111 1 11110000018000",
    });
    const vicente = parcela({
      alunoId: "487",
      alunoNome: "Vicente Cordeiro Borges",
      saldo: 100,
      linhaDigitavel: "22222.22222 22222.222222 22222.222222 2 22220000010000",
    });

    const grupos = agruparLembretesPorResponsavel([heitor, vicente], "2026-08-17");
    expect(grupos).toHaveLength(1);
    const { linhaDigitavel, valorTotal } = grupos[0];

    expect(linhaDigitavel).toContain(heitor.linhaDigitavel);
    expect(linhaDigitavel).toContain(vicente.linhaDigitavel);
    expect(linhaDigitavel).toBe(
      `Heitor Cordeiro Borges: R$ 180,00, linha digitável ${heitor.linhaDigitavel}; ` +
        `Vicente Cordeiro Borges: R$ 100,00, linha digitável ${vicente.linhaDigitavel}`,
    );

    // A soma dos valores apresentados ao lado das linhas bate com o total.
    const valores = [...linhaDigitavel.matchAll(/R\$ ([\d.]+),(\d{2})/g)].map(
      (m) => Number(m[1].replace(/\./g, "")) + Number(m[2]) / 100,
    );
    expect(valores).toEqual([180, 100]);
    expect(valores.reduce((s, v) => s + v, 0)).toBe(valorTotal);
  });

  it("mantém a ordem determinística e não deixa nenhuma linha ser sobrescrita", () => {
    const parcelas = ["A", "B", "C"].map((nome, i) =>
      parcela({
        alunoId: `60${i}`,
        alunoNome: nome,
        saldo: 100 + i,
        linhaDigitavel: `linha-${nome}`,
      }),
    );
    const [grupo] = agruparLembretesPorResponsavel(parcelas, "2026-08-17");
    expect(grupo.linhaDigitavel.indexOf("linha-A")).toBeLessThan(
      grupo.linhaDigitavel.indexOf("linha-B"),
    );
    expect(grupo.linhaDigitavel.indexOf("linha-B")).toBeLessThan(
      grupo.linhaDigitavel.indexOf("linha-C"),
    );
    // Parâmetro de template da Meta não aceita quebra de linha nem espaço duplo.
    expect(grupo.linhaDigitavel).not.toMatch(/[\n\t]|\s{2}/);
  });

  it("é idempotente: telefone já lembrado hoje não entra de novo", () => {
    const grupos = agruparLembretesPorResponsavel([parcela()], "2026-08-17");
    const enviadosHoje = ["+55 31 98823-0304"];
    expect(jaCobradoHoje(enviadosHoje, grupos[0].telefone)).toBe(true);
    expect(jaCobradoHoje([], grupos[0].telefone)).toBe(false);
  });
});

describe("prioridade da cobrança automática no mesmo dia", () => {
  it("pula o lembrete de quem recebeu cobrança de parcela vencida hoje", () => {
    const grupos = agruparLembretesPorResponsavel([parcela()], "2026-08-17");
    expect(filtrarPorPrioridadeCobranca(grupos, ["5531988230304"])).toEqual([]);
  });

  it("não confunde responsáveis por causa de formatação, DDI ou 9º dígito", () => {
    const grupos = agruparLembretesPorResponsavel([parcela()], "2026-08-17");
    expect(filtrarPorPrioridadeCobranca(grupos, ["3188230304"])).toEqual([]);
    expect(filtrarPorPrioridadeCobranca(grupos, ["(31) 97777-0000"])).toHaveLength(1);
  });

  it("mantém o lembrete de quem não tem cobrança hoje", () => {
    const grupos = agruparLembretesPorResponsavel([parcela()], "2026-08-17");
    expect(filtrarPorPrioridadeCobranca(grupos, [])).toHaveLength(1);
  });
});

describe("calendário", () => {
  // Fim de semana e feriado não disparam: o cron nem roda a régua nesses dias, e
  // o lembrete daquele prazo é perdido em vez de deslocado — antecipar mudaria o
  // texto aprovado ("em 5 dias") e atrasar avisaria depois do vencimento.
  it("reconhece os dias em que a régua não roda", () => {
    expect(isDiaUtil("2026-08-15")).toBe(false); // sábado
    expect(isDiaUtil("2026-08-16")).toBe(false); // domingo
    expect(isDiaUtil("2026-09-07")).toBe(false); // Independência
    expect(isDiaUtil("2026-08-17")).toBe(true);
  });
});
