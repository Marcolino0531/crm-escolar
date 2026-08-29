import { describe, expect, it } from "vitest";
import {
  DESAFIO_VAZIO,
  anoLetivoValido,
  cronogramaMaterialFaseB,
  opcoesParcelamentoMaterialPrimeira,
  parcelamentoMaterialPrimeira,
  primeiraMensalidadeDoAnoLetivo,
  vencimentosMaterialPelasMensalidades,
  MAX_TENTATIVAS_CODIGO,
  MENSAGEM_BLOQUEADO,
  MENSAGEM_CODIGO_EXPIRADO,
  MENSAGEM_CODIGO_INCORRETO,
  chaveSerie,
  concentrarDiferenca,
  codigoFormatoValido,
  expiracaoCodigo,
  gerarCodigoVerificacao,
  opcoesParcelamentoMaterial,
  parcelamentoMaterial,
  parcelasMaterialLancamento,
  primeiroVencimentoMaterial,
  rotuloParcelamento,
  rotuloParcelamentoPrimeira,
  serieDaTurma,
  validarCodigo,
  type DesafioCodigo,
} from "@/lib/rematricula";
import type { ParcelaAberta } from "@/lib/cantina";
import { isDiaUtil, isFeriadoNacional } from "@/lib/billing-schedule";

// Intl usa espaço não separável depois de "R$": normaliza para comparar texto.
function semNbsp(s: string): string {
  return s.replace(/\u00a0/g, " ");
}

describe("parcelamento do material pedagógico", () => {
  it("divide em partes iguais quando a divisão é exata", () => {
    const op = parcelamentoMaterial(1200, 4);
    expect(op.valorParcela).toBe(300);
    expect(op.valorUltimaParcela).toBe(300);
  });

  it("joga os centavos da divisão inexata na última parcela", () => {
    const op = parcelamentoMaterial(1000, 3);
    expect(op.valorParcela).toBe(333.33);
    expect(op.valorUltimaParcela).toBe(333.34);
    expect(op.valorParcela * 2 + op.valorUltimaParcela).toBeCloseTo(1000, 2);
  });

  it("mantém o total exato em todas as opções de 1x a 8x", () => {
    for (const valorAnual of [1000, 1234.56, 987.65, 2400, 1999.99]) {
      for (const op of opcoesParcelamentoMaterial(valorAnual)) {
        const somaCentavos =
          Math.round(op.valorParcela * 100) * (op.parcelas - 1) +
          Math.round(op.valorUltimaParcela * 100);
        expect(somaCentavos).toBe(Math.round(valorAnual * 100));
      }
    }
  });

  it("oferece exatamente 1x a 8x", () => {
    const opcoes = opcoesParcelamentoMaterial(800);
    expect(opcoes.map((o) => o.parcelas)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("em 1x a parcela única é o valor anual", () => {
    const op = parcelamentoMaterial(1234.56, 1);
    expect(op.valorParcela).toBe(1234.56);
    expect(op.valorUltimaParcela).toBe(1234.56);
    expect(semNbsp(rotuloParcelamento(op))).toBe("1x de R$ 1.234,56");
  });

  it("recusa parcelamento fora de 1 a 8", () => {
    expect(() => parcelamentoMaterial(1000, 0)).toThrow();
    expect(() => parcelamentoMaterial(1000, 9)).toThrow();
    expect(() => parcelamentoMaterial(1000, 2.5)).toThrow();
  });

  it("mostra a diferença da última parcela no rótulo", () => {
    expect(semNbsp(rotuloParcelamento(parcelamentoMaterial(1000, 3)))).toBe(
      "3x de R$ 333,33 (última de R$ 333,34)",
    );
  });
});

describe("código de verificação", () => {
  it("gera sempre 6 dígitos, inclusive com zeros à esquerda", () => {
    expect(gerarCodigoVerificacao(0)).toBe("000000");
    expect(codigoFormatoValido(gerarCodigoVerificacao(0.004821))).toBe(true);
    expect(gerarCodigoVerificacao(0.004821)).toBe("004821");
    expect(gerarCodigoVerificacao(0.999999999)).toHaveLength(6);
    for (const sorteio of [0.1, 0.42, 0.777, 0.98765]) {
      expect(codigoFormatoValido(gerarCodigoVerificacao(sorteio))).toBe(true);
    }
  });

  it("expira 10 minutos depois da geração", () => {
    const agora = "2026-03-10T12:00:00.000Z";
    expect(expiracaoCodigo(agora)).toBe("2026-03-10T12:10:00.000Z");
  });

  const agora = "2026-03-10T12:00:00.000Z";
  const desafio = (over: Partial<DesafioCodigo> = {}): DesafioCodigo => ({
    ...DESAFIO_VAZIO,
    codigoHash: "hash-certo",
    expiraEm: expiracaoCodigo(agora),
    ...over,
  });

  it("aceita o código correto dentro da validade e o consome", () => {
    const res = validarCodigo(desafio(), "hash-certo", agora);
    expect(res.ok).toBe(true);
    expect(res.proximo.consumidoEm).toBe(agora);
  });

  it("recusa o mesmo código numa segunda vez (uso único)", () => {
    const primeiro = validarCodigo(desafio(), "hash-certo", agora);
    const segundo = validarCodigo(primeiro.proximo, "hash-certo", agora);
    expect(segundo.ok).toBe(false);
    expect(segundo.motivo).toBe("inexistente");
  });

  it("recusa código depois dos 10 minutos", () => {
    const res = validarCodigo(desafio(), "hash-certo", "2026-03-10T12:10:01.000Z");
    expect(res.ok).toBe(false);
    expect(res.motivo).toBe("expirado");
    expect(res.mensagem).toBe(MENSAGEM_CODIGO_EXPIRADO);
  });

  it("aceita no limite exato antes de expirar e recusa no instante da expiração", () => {
    expect(validarCodigo(desafio(), "hash-certo", "2026-03-10T12:09:59.999Z").ok).toBe(true);
    expect(validarCodigo(desafio(), "hash-certo", "2026-03-10T12:10:00.000Z").ok).toBe(false);
  });

  it("conta tentativa errada e bloqueia na terceira", () => {
    let estado = desafio();
    for (let i = 1; i < MAX_TENTATIVAS_CODIGO; i++) {
      const res = validarCodigo(estado, "hash-errado", agora);
      expect(res.ok).toBe(false);
      expect(res.motivo).toBe("incorreto");
      expect(res.mensagem).toBe(MENSAGEM_CODIGO_INCORRETO);
      expect(res.proximo.bloqueadoAte).toBeNull();
      estado = res.proximo;
    }
    const terceira = validarCodigo(estado, "hash-errado", agora);
    expect(terceira.ok).toBe(false);
    expect(terceira.motivo).toBe("bloqueado");
    expect(terceira.mensagem).toBe(MENSAGEM_BLOQUEADO);
    expect(terceira.proximo.bloqueadoAte).not.toBeNull();
  });

  it("depois do bloqueio recusa até o código correto", () => {
    let estado = desafio();
    for (let i = 0; i < MAX_TENTATIVAS_CODIGO; i++) {
      estado = validarCodigo(estado, "hash-errado", agora).proximo;
    }
    const res = validarCodigo(estado, "hash-certo", agora);
    expect(res.ok).toBe(false);
    expect(res.motivo).toBe("bloqueado");
  });

  it("não conta tentativa quando o desafio nem existe", () => {
    const res = validarCodigo(DESAFIO_VAZIO, "qualquer", agora);
    expect(res.ok).toBe(false);
    expect(res.proximo.tentativas).toBe(0);
  });
});

describe("série do aluno", () => {
  it("tira a letra da turma e o turno", () => {
    expect(serieDaTurma("3º Ano A - Manhã")).toBe("3º Ano");
    expect(serieDaTurma("1º Período B (Tarde)")).toBe("1º Período");
    expect(serieDaTurma("Maternal II")).toBe("Maternal II");
    expect(serieDaTurma("Berçário")).toBe("Berçário");
  });

  it("casa variações de acento e ordinal na mesma chave", () => {
    expect(chaveSerie("3º Ano")).toBe(chaveSerie("3 ano"));
    expect(chaveSerie("1º Período")).toBe(chaveSerie("1o periodo"));
    expect(chaveSerie(" Maternal  II ")).toBe("maternal ii");
  });
});

describe("primeiro vencimento do material", () => {
  const parcela = (
    vencimento: string,
    categoria: string,
    saldo = 1200,
    quitada = false,
  ): ParcelaAberta => ({
    contaReceberID: `c-${vencimento}`,
    numeroBoleto: "1",
    numeroParcela: "1",
    vencimento,
    categoria,
    saldo,
    quitada,
  });

  it("usa o vencimento da próxima mensalidade real em aberto", () => {
    const r = primeiroVencimentoMaterial(
      [
        parcela("2026-02-10", "Mensalidade"),
        parcela("2026-03-10", "Mensalidade"),
        parcela("2026-01-10", "Mensalidade", 1200, true),
      ],
      "2026-01-20",
    );
    expect(r).toEqual({ vencimento: "2026-02-10", origem: "mensalidade" });
  });

  it("ignora recarga de cantina e acordo como referência", () => {
    const r = primeiroVencimentoMaterial(
      [parcela("2026-02-05", "Cantina"), parcela("2026-02-15", "Mensalidade")],
      "2026-01-20",
    );
    expect(r.vencimento).toBe("2026-02-15");
  });

  it("cai no dia habitual do aluno quando não há mensalidade futura em aberto", () => {
    const r = primeiroVencimentoMaterial(
      [
        parcela("2025-11-10", "Mensalidade", 1200, true),
        parcela("2025-12-10", "Mensalidade", 1200, true),
      ],
      "2026-01-20",
    );
    expect(r.origem).toBe("dia_habitual");
    expect(r.vencimento).toBe("2026-02-10");
  });

  it("empurra o dia habitual que cai em fim de semana para o próximo dia útil", () => {
    // 10/01/2026 é sábado.
    const r = primeiroVencimentoMaterial(
      [parcela("2025-11-10", "Mensalidade", 1200, true)],
      "2025-12-20",
    );
    expect(r.origem).toBe("dia_habitual");
    expect(r.vencimento).toBe("2026-01-12");
  });

  it("usa o vencimento padrão quando o aluno não tem histórico", () => {
    const r = primeiroVencimentoMaterial([], "2026-01-20");
    expect(r.origem).toBe("padrao");
    expect(isDiaUtil(r.vencimento)).toBe(true);
  });
});

describe("cronograma das parcelas do material", () => {
  it("gera 8 parcelas somando exatamente o valor anual, com centavos na última", () => {
    const itens = parcelasMaterialLancamento(1000, 8, "2026-02-10");
    expect(itens).toHaveLength(8);
    expect(itens.slice(0, 7).every((p) => p.valor === 125)).toBe(true);
    expect(itens[7].valor).toBe(125);
    const soma = itens.reduce((acc, p) => acc + Math.round(p.valor * 100), 0);
    expect(soma).toBe(100000);
  });

  it("joga a sobra de centavos na última parcela", () => {
    const itens = parcelasMaterialLancamento(1000, 3, "2026-02-10");
    expect(itens.map((p) => p.valor)).toEqual([333.33, 333.33, 333.34]);
    expect(itens.reduce((acc, p) => acc + Math.round(p.valor * 100), 0)).toBe(100000);
  });

  it("avança um mês por parcela mantendo o dia da primeira", () => {
    const itens = parcelasMaterialLancamento(800, 4, "2026-03-10");
    expect(itens.map((p) => p.vencimento)).toEqual([
      "2026-03-10",
      "2026-04-10",
      "2026-05-11", // 10/05/2026 é domingo
      "2026-06-10",
    ]);
  });

  it("empurra vencimento que cai em feriado nacional", () => {
    // 1º parcela em 01/03; a de setembro cairia em 07/09 (Independência).
    const itens = parcelasMaterialLancamento(700, 7, "2026-03-07");
    expect(itens[6].vencimento).toBe("2026-09-08");
    expect(isFeriadoNacional("2026-09-07")).toBe(true);
  });

  it("mantém o primeiro vencimento exatamente como informado", () => {
    // Mesmo dia da mensalidade do aluno: não é reajustado pela regra de dia útil.
    const itens = parcelasMaterialLancamento(800, 2, "2026-02-14");
    expect(itens[0].vencimento).toBe("2026-02-14");
  });

  it("concentra a sobra de centavos na primeira parcela, como a tela nativa", () => {
    const itens = concentrarDiferenca(parcelasMaterialLancamento(1000, 3, "2026-02-10"), true);
    expect(itens.map((p) => p.valor)).toEqual([333.34, 333.33, 333.33]);
    expect(itens.reduce((acc, p) => acc + Math.round(p.valor * 100), 0)).toBe(100000);
    expect(itens.map((p) => p.vencimento)).toEqual(["2026-02-10", "2026-03-10", "2026-04-10"]);
  });

  it("não muda nada quando a divisão é exata ou a sobra fica na última", () => {
    const exato = parcelasMaterialLancamento(1000, 8, "2026-02-10");
    expect(concentrarDiferenca(exato, true)).toEqual(exato);
    const inexato = parcelasMaterialLancamento(800.05, 8, "2026-02-10");
    expect(concentrarDiferenca(inexato, false)).toEqual(inexato);
    expect(concentrarDiferenca(inexato, true).map((p) => p.valor)).toEqual([
      100.05, 100, 100, 100, 100, 100, 100, 100,
    ]);
  });

  it("recusa parcelamento fora de 1 a 8 e data inválida", () => {
    expect(() => parcelasMaterialLancamento(800, 9, "2026-02-10")).toThrow();
    expect(() => parcelasMaterialLancamento(800, 8, "10/02/2026")).toThrow();
  });

  it("uma parcela só é o valor anual inteiro", () => {
    expect(parcelasMaterialLancamento(999.99, 1, "2026-02-10")).toEqual([
      { numero: 1, valor: 999.99, vencimento: "2026-02-10" },
    ]);
  });
});

// ─── Fase B: ano letivo de referência, sobra na 1ª parcela e vencimentos ────

describe("parcelamento da Fase B (sobra na 1ª parcela)", () => {
  it("reproduz a tela nativa do Sponte: 1.000,00 em 3x", () => {
    const op = parcelamentoMaterialPrimeira(1000, 3);
    expect(op.valorParcela).toBe(333.33);
    expect(op.valorPrimeiraParcela).toBe(333.34);
    expect(op.valorPrimeiraParcela + op.valorParcela * 2).toBeCloseTo(1000, 2);
  });

  it("fecha o valor anual exato em todas as opções de 1x a 8x", () => {
    for (const op of opcoesParcelamentoMaterialPrimeira(800.05)) {
      const centavos =
        Math.round(op.valorPrimeiraParcela * 100) +
        Math.round(op.valorParcela * 100) * (op.parcelas - 1);
      expect(centavos).toBe(80005);
    }
  });

  it("em divisão exata a 1ª parcela não é diferenciada", () => {
    const op = parcelamentoMaterialPrimeira(1200, 4);
    expect(op.valorPrimeiraParcela).toBe(300);
    expect(semNbsp(rotuloParcelamentoPrimeira(op))).toBe("4x de R$ 300,00");
    expect(semNbsp(rotuloParcelamentoPrimeira(parcelamentoMaterialPrimeira(1000, 3)))).toBe(
      "3x de R$ 333,33 (1ª de R$ 333,34)",
    );
  });

  it("recusa parcelamento fora de 1 a 8", () => {
    expect(() => parcelamentoMaterialPrimeira(800, 0)).toThrow();
    expect(() => parcelamentoMaterialPrimeira(800, 9)).toThrow();
  });
});

describe("primeira mensalidade do ano letivo configurado", () => {
  const parcela = (
    vencimento: string,
    categoria: string,
    saldo = 1200,
    quitada = false,
  ): ParcelaAberta => ({
    contaReceberID: `c-${vencimento}`,
    numeroBoleto: "1",
    numeroParcela: "1",
    vencimento,
    categoria,
    saldo,
    quitada,
  });

  const carne: ParcelaAberta[] = [
    parcela("2026-08-10", "Mensalidade"),
    parcela("2026-12-10", "Mensalidade"),
    parcela("2027-01-10", "Mensalidade"),
    parcela("2027-02-10", "Mensalidade"),
    parcela("2027-03-10", "Mensalidade"),
  ];

  it("ancora na menor data em aberto DENTRO do ano configurado", () => {
    expect(primeiraMensalidadeDoAnoLetivo(carne, 2027)?.vencimento).toBe("2027-01-10");
  });

  it("não depende da data em que o responsável preenche o formulário", () => {
    // A função não recebe "hoje": agosto/2026 e janeiro/2027 caem na mesma âncora.
    expect(primeiraMensalidadeDoAnoLetivo(carne, 2027)?.vencimento).toBe(
      primeiraMensalidadeDoAnoLetivo([...carne].reverse(), 2027)?.vencimento,
    );
  });

  it("ignora mensalidade já quitada e a de outro ano", () => {
    const comQuitada = [parcela("2027-01-05", "Mensalidade", 1200, true), ...carne];
    expect(primeiraMensalidadeDoAnoLetivo(comQuitada, 2027)?.vencimento).toBe("2027-01-10");
    expect(primeiraMensalidadeDoAnoLetivo(carne, 2026)?.vencimento).toBe("2026-08-10");
  });

  it("ignora cantina e acordo como âncora", () => {
    const r = primeiraMensalidadeDoAnoLetivo(
      [parcela("2027-01-05", "Cantina"), parcela("2027-01-10", "Mensalidade")],
      2027,
    );
    expect(r?.vencimento).toBe("2027-01-10");
  });

  it("devolve nulo quando não existe mensalidade em aberto no ano configurado", () => {
    expect(primeiraMensalidadeDoAnoLetivo(carne, 2028)).toBeNull();
  });

  it("valida o intervalo do ano letivo de referência", () => {
    expect(anoLetivoValido(2027)).toBe(true);
    expect(anoLetivoValido(2023)).toBe(false);
    expect(anoLetivoValido(2026.5)).toBe(false);
  });
});

describe("vencimentos do material pelas mensalidades", () => {
  const parcela = (vencimento: string, categoria = "Mensalidade"): ParcelaAberta => ({
    contaReceberID: `c-${vencimento}`,
    numeroBoleto: "1",
    numeroParcela: "1",
    vencimento,
    categoria,
    saldo: 1200,
    quitada: false,
  });

  const mensalidades = [
    parcela("2027-01-10"),
    parcela("2027-02-08"),
    parcela("2027-03-12"),
    parcela("2027-04-10"),
  ];

  it("cada parcela vence no mesmo dia da mensalidade daquele mês", () => {
    expect(vencimentosMaterialPelasMensalidades(mensalidades, "2027-01-10", 4)).toEqual([
      "2027-01-10",
      "2027-02-08",
      "2027-03-12",
      "2027-04-10",
    ]);
  });

  it("não aplica nenhum ajuste de feriado nem de fim de semana", () => {
    // 21/04/2027 é Tiradentes e 09/05/2027 é domingo: as duas datas são mantidas.
    const datas = vencimentosMaterialPelasMensalidades(
      [parcela("2027-04-21"), parcela("2027-05-09")],
      "2027-04-21",
      2,
    );
    expect(datas).toEqual(["2027-04-21", "2027-05-09"]);
    expect(isFeriadoNacional("2027-04-21")).toBe(true);
    expect(isDiaUtil("2027-05-09")).toBe(false);
  });

  it("mês sem mensalidade cadastrada mantém o dia da 1ª parcela", () => {
    expect(vencimentosMaterialPelasMensalidades([parcela("2027-01-10")], "2027-01-10", 3)).toEqual([
      "2027-01-10",
      "2027-02-10",
      "2027-03-10",
    ]);
  });

  it("com duas mensalidades no mesmo mês vale a de menor vencimento", () => {
    expect(
      vencimentosMaterialPelasMensalidades(
        [parcela("2027-01-10"), parcela("2027-01-25")],
        "2027-01-10",
        1,
      ),
    ).toEqual(["2027-01-10"]);
  });

  it("cronograma final leva a sobra na 1ª parcela e os vencimentos reais", () => {
    const c = cronogramaMaterialFaseB(
      1000,
      3,
      vencimentosMaterialPelasMensalidades(mensalidades, "2027-01-10", 3),
    );
    expect(c.itens).toEqual([
      { numero: 1, valor: 333.34, vencimento: "2027-01-10" },
      { numero: 2, valor: 333.33, vencimento: "2027-02-08" },
      { numero: 3, valor: 333.33, vencimento: "2027-03-12" },
    ]);
    expect(c.valorParcela).toBe(333.33);
    expect(c.ajustaPrimeira).toBe(true);
    expect(
      cronogramaMaterialFaseB(1200, 4, ["2027-01-10", "2027-02-08", "2027-03-12", "2027-04-10"])
        .ajustaPrimeira,
    ).toBe(false);
  });

  it("recusa vencimentos em quantidade diferente das parcelas e data inválida", () => {
    expect(() => cronogramaMaterialFaseB(1000, 3, ["2027-01-10"])).toThrow();
    expect(() => vencimentosMaterialPelasMensalidades(mensalidades, "10/01/2027", 3)).toThrow();
  });
});
