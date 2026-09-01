import { describe, expect, it } from "vitest";
import {
  MAX_LINKS_POR_JANELA,
  MENSAGEM_LINK_INVALIDO,
  anoLetivoValido,
  cronogramaMaterialFaseB,
  opcoesParcelamentoMaterialPrimeira,
  parcelamentoMaterialPrimeira,
  primeiraMensalidadeDoAnoLetivo,
  vencimentosMaterialPelasMensalidades,
  assuntoEmailRematricula,
  corpoEmailRematricula,
  MENSAGEM_LINK_ENVIADO,
  mascararEmail,
  mensagemLinkEnviadoPara,
  resultadoEnvioLink,
  MENSAGEM_FALHA_ENVIO_LINK,
  chaveSerie,
  concentrarDiferenca,
  excedeuLimiteLinks,
  expiracaoLink,
  inicioJanelaLinks,
  opcoesParcelamentoMaterial,
  parcelamentoMaterial,
  parcelasMaterialLancamento,
  primeiroVencimentoMaterial,
  rotuloParcelamento,
  rotuloParcelamentoPrimeira,
  serieDaTurma,
  solicitacoesNaJanela,
  urlLinkRematricula,
  validarLinkMagico,
  type LinkMagico,
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

describe("link mágico de acesso", () => {
  const agora = "2026-03-10T12:00:00.000Z";
  const link = (over: Partial<LinkMagico> = {}): LinkMagico => ({
    expiraEm: expiracaoLink(agora),
    usadoEm: null,
    ...over,
  });

  it("expira 15 minutos depois da geração", () => {
    expect(expiracaoLink(agora)).toBe("2026-03-10T12:15:00.000Z");
  });

  it("aceita o link dentro da validade", () => {
    expect(validarLinkMagico(link(), agora).ok).toBe(true);
  });

  it("aceita no último instante antes de expirar e recusa no instante da expiração", () => {
    expect(validarLinkMagico(link(), "2026-03-10T12:14:59.999Z").ok).toBe(true);
    const noLimite = validarLinkMagico(link(), "2026-03-10T12:15:00.000Z");
    expect(noLimite.ok).toBe(false);
    expect(noLimite.motivo).toBe("expirado");
  });

  it("recusa link vencido", () => {
    const res = validarLinkMagico(link(), "2026-03-10T12:15:01.000Z");
    expect(res.ok).toBe(false);
    expect(res.motivo).toBe("expirado");
    expect(res.mensagem).toBe(MENSAGEM_LINK_INVALIDO);
  });

  it("é de uso único: link já usado é recusado mesmo dentro dos 15 minutos", () => {
    const res = validarLinkMagico(link({ usadoEm: "2026-03-10T12:01:00.000Z" }), agora);
    expect(res.ok).toBe(false);
    expect(res.motivo).toBe("usado");
    expect(res.mensagem).toBe(MENSAGEM_LINK_INVALIDO);
  });

  it("recusa token desconhecido com a mesma mensagem do expirado/usado", () => {
    const res = validarLinkMagico(null, agora);
    expect(res.ok).toBe(false);
    expect(res.motivo).toBe("inexistente");
    expect(res.mensagem).toBe(MENSAGEM_LINK_INVALIDO);
  });

  it("recusa link sem data de expiração", () => {
    expect(validarLinkMagico(link({ expiraEm: null }), agora).ok).toBe(false);
  });

  it("monta a URL de verificação do portal", () => {
    expect(urlLinkRematricula("https://schoolhubbr.vercel.app", "abc123")).toBe(
      "https://schoolhubbr.vercel.app/rematricula/verificar?token=abc123",
    );
    expect(urlLinkRematricula("https://schoolhubbr.vercel.app/", "abc123")).toContain(
      "/rematricula/verificar?token=abc123",
    );
  });

  it("assunto e corpo do email levam o colégio e o link", () => {
    expect(assuntoEmailRematricula(" Colégio Exemplo ")).toBe(
      "Acesse a Rematrícula — Colégio Exemplo",
    );
    expect(assuntoEmailRematricula("")).toBe("Acesse a Rematrícula");
    const corpo = corpoEmailRematricula({
      responsavelNome: "Maria",
      alunoNome: "João",
      nomeColegio: "Colégio Exemplo",
      url: "https://schoolhubbr.vercel.app/rematricula/verificar?token=abc",
      emailMascarado: "s**************@g****.com",
    });
    expect(corpo.text).toContain("Olá, Maria");
    expect(corpo.text).toContain("João");
    expect(corpo.text).toContain("token=abc");
    expect(corpo.text).toContain("s**************@g****.com");
    expect(corpo.html).toContain(
      '<a href="https://schoolhubbr.vercel.app/rematricula/verificar?token=abc">',
    );
  });
});

describe("email mascarado do destino", () => {
  it("mantém só a 1ª letra do usuário e a 1ª do domínio", () => {
    expect(mascararEmail("sergiogmribeiro@gmail.com")).toBe("s**************@g****.com");
    expect(mascararEmail("joao@gmail.com")).toBe("j***@g****.com");
  });

  it("preserva subdomínios e domínios compostos", () => {
    expect(mascararEmail("contato@colegio.com.br")).toBe("c******@c******.com.br");
  });

  it("nunca deixa o usuário ou o domínio de 1 letra a descoberto", () => {
    expect(mascararEmail("a@b.com")).toBe("a*@b*.com");
  });

  it("devolve vazio para email inválido, sem quebrar o fluxo", () => {
    expect(mascararEmail("")).toBe("");
    expect(mascararEmail("sem-arroba")).toBe("");
    expect(mascararEmail("@gmail.com")).toBe("");
    expect(mascararEmail("joao@")).toBe("");
  });

  it("cai na mensagem genérica quando não há máscara para mostrar", () => {
    expect(mensagemLinkEnviadoPara("j***@g****.com")).toContain("j***@g****.com");
    expect(mensagemLinkEnviadoPara("j***@g****.com")).toContain("15 minutos");
    expect(mensagemLinkEnviadoPara("")).toBe(MENSAGEM_LINK_ENVIADO);
  });

  it("só anuncia envio quando o email foi aceito", () => {
    expect(resultadoEnvioLink(true, "j***@g****.com")).toEqual({
      ok: true,
      mensagem: mensagemLinkEnviadoPara("j***@g****.com"),
    });
    expect(resultadoEnvioLink(false, "j***@g****.com")).toEqual({
      ok: false,
      mensagem: MENSAGEM_FALHA_ENVIO_LINK,
    });
  });
});

describe("rate limit de links por CPF", () => {
  const agora = "2026-03-10T12:00:00.000Z";
  const minutosAtras = (m: number) => new Date(Date.parse(agora) - m * 60000).toISOString();

  it("conta só as solicitações da última hora", () => {
    const pedidos = [minutosAtras(5), minutosAtras(59), minutosAtras(61), minutosAtras(600)];
    expect(solicitacoesNaJanela(pedidos, agora)).toBe(2);
    expect(inicioJanelaLinks(agora)).toBe("2026-03-10T11:00:00.000Z");
  });

  it("libera do 1º ao 3º pedido e bloqueia o 4º na mesma hora", () => {
    const pedidos: string[] = [];
    for (let i = 0; i < MAX_LINKS_POR_JANELA; i++) {
      expect(excedeuLimiteLinks(pedidos, agora)).toBe(false);
      pedidos.push(minutosAtras(i));
    }
    expect(pedidos).toHaveLength(3);
    expect(excedeuLimiteLinks(pedidos, agora)).toBe(true);
  });

  it("volta a liberar quando os 3 pedidos saem da janela de 1 hora", () => {
    const pedidos = [minutosAtras(61), minutosAtras(75), minutosAtras(90)];
    expect(excedeuLimiteLinks(pedidos, agora)).toBe(false);
  });

  it("ainda bloqueia se um dos 3 pedidos foi feito há 59 minutos", () => {
    const pedidos = [minutosAtras(59), minutosAtras(30), minutosAtras(1)];
    expect(excedeuLimiteLinks(pedidos, agora)).toBe(true);
  });

  it("ignora datas inválidas gravadas na tabela", () => {
    expect(solicitacoesNaJanela(["", "nao-e-data", minutosAtras(1)], agora)).toBe(1);
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
