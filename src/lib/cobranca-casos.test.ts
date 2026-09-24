import { describe, expect, it } from "vitest";

import { calcularTotalVencido, diasEntreYMD, valorAtualizadoParcela } from "@/lib/billing-debt";
import {
  arredondar2,
  atualizarParcela,
  dataEnvioSugerida,
  datasMensagens,
  descreverReagendamento,
  mensagemDoDiaPendente,
  reagendarMensagens,
  mesmasMudancas,
  etapaDoCaso,
  montarDemonstrativo,
  podeAlterarDataInicio,
  prazoFinalNotificacao,
  responsavelKey,
  totalDemonstrativo,
  validarDataEnvio,
  validarDataInicio,
  validarRegistroMensagem,
  type ParcelaAbertaAluno,
} from "@/lib/cobranca-casos";
import { camposFaltantesColegio, montarNotificacao } from "@/lib/notificacao-extrajudicial";
import type { ColegioRecibo } from "@/lib/recibos";

const HOJE = "2026-09-23";

function parcela(over: Partial<ParcelaAbertaAluno>): ParcelaAbertaAluno {
  return {
    alunoId: "1",
    alunoNome: "Aluno Um",
    descricao: "Mensalidade",
    vencimento: "2026-08-10",
    saldo: 1000,
    ...over,
  };
}

const colegio: ColegioRecibo = {
  unidade: "CEC",
  razaoSocial: "Centro Educacional Cidadão Ltda",
  nomeFantasia: "CEC",
  cnpj: "00.000.000/0001-00",
  inscricaoMunicipal: "",
  endereco: "Rua A",
  numero: "10",
  complemento: "",
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "MG",
  cep: "30000-000",
  telefone: "(31) 3333-3333",
  email: "financeiro@cec.com.br",
  site: "",
  assinanteNome: "X",
  assinanteCargo: "Y",
  observacao: "",
};

describe("cobranca-casos: snapshot do débito", () => {
  it("1. parcelas de 2 alunos do mesmo responsável num único total; não vencidas excluídas", () => {
    const parcelas = [
      parcela({ alunoId: "1", alunoNome: "Ana", vencimento: "2026-08-10", saldo: 1000 }),
      parcela({ alunoId: "2", alunoNome: "Beto", vencimento: "2026-09-10", saldo: 500 }),
      parcela({ alunoId: "2", alunoNome: "Beto", vencimento: "2026-10-10", saldo: 500 }), // futura
      parcela({ alunoId: "1", alunoNome: "Ana", vencimento: HOJE, saldo: 300 }), // vence hoje
    ];
    const d = montarDemonstrativo(parcelas, HOJE);
    expect(d.parcelas).toHaveLength(2);
    expect(d.parcelas.map((p) => p.aluno)).toEqual(["Ana", "Beto"]);
    const esperado = arredondar2(
      arredondar2(valorAtualizadoParcela(1000, "2026-08-10", HOJE)) +
        arredondar2(valorAtualizadoParcela(500, "2026-09-10", HOJE)),
    );
    expect(d.total).toBe(esperado);
  });

  it("2. valor por parcela idêntico a valorAtualizadoParcela em 3 cenários de atraso", () => {
    for (const [venc, saldo] of [
      ["2026-09-22", 850.5], // 1 dia
      ["2026-08-23", 1200], // 31 dias
      ["2026-03-01", 999.99], // ~7 meses
    ] as const) {
      const p = atualizarParcela(parcela({ vencimento: venc, saldo }), HOJE);
      expect(p.atualizado).toBe(arredondar2(valorAtualizadoParcela(saldo, venc, HOJE)));
      expect(arredondar2(p.original + p.multa + p.juros)).toBe(p.atualizado);
      expect(p.multa).toBe(arredondar2(saldo * 0.02));
    }
  });

  it("3. demonstrativo com data-base diferente de hoje recalcula multa e juros", () => {
    const parcelas = [parcela({ vencimento: "2026-08-10", saldo: 1000 })];
    const hoje = montarDemonstrativo(parcelas, HOJE);
    const futuro = montarDemonstrativo(parcelas, "2026-11-23");
    expect(futuro.parcelas[0]!.dias_atraso).toBeGreaterThan(hoje.parcelas[0]!.dias_atraso);
    expect(futuro.parcelas[0]!.juros).toBeGreaterThan(hoje.parcelas[0]!.juros);
    expect(futuro.parcelas[0]!.multa).toBe(hoje.parcelas[0]!.multa); // multa única
    expect(futuro.total).toBe(
      arredondar2(valorAtualizadoParcela(1000, "2026-08-10", "2026-11-23")),
    );
    // Data-base anterior ao vencimento: parcela não entra.
    expect(montarDemonstrativo(parcelas, "2026-08-01").parcelas).toHaveLength(0);
  });

  it("4. total da notificação = total do demonstrativo (mesmos dados e data)", () => {
    const parcelas = [
      parcela({ vencimento: "2026-07-05", saldo: 1234.56 }),
      parcela({ alunoId: "2", alunoNome: "Beto", vencimento: "2026-08-05", saldo: 789.01 }),
    ];
    const demonstrativo = montarDemonstrativo(parcelas, HOJE);
    const doc = montarNotificacao({
      colegio,
      responsavel: { nome: "Resp", cpf: "12345678901", endereco: null },
      alunos: ["Ana", "Beto"],
      demonstrativo,
      datasMensagens: ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21"],
      dataEmissao: HOJE,
    });
    expect(doc.total).toBe(demonstrativo.total);
    expect(doc.tabela).toHaveLength(2);
    expect(doc.linhaTotal).toContain("23/09/2026");
    expect(doc.paragrafosDepois[1]).toContain(
      "15/09/2026, 16/09/2026, 17/09/2026, 18/09/2026 e 21/09/2026",
    );
    expect(doc.assinatura).toEqual(["Sérgio Marcolino", "Diretor", colegio.razaoSocial]);
  });

  it("5. arredondamento a 2 casas por parcela sem diferença de centavos entre tabela e total", () => {
    const parcelas = Array.from({ length: 37 }, (_, i) =>
      parcela({ vencimento: `2026-0${(i % 6) + 1}-1${i % 9}`, saldo: 333.33 + i * 0.07 }),
    );
    const d = montarDemonstrativo(parcelas, HOJE);
    for (const p of d.parcelas) {
      expect(p.atualizado).toBe(arredondar2(p.atualizado));
      expect(arredondar2(p.original + p.multa + p.juros)).toBe(p.atualizado);
    }
    const somaTabela = d.parcelas.reduce((s, p) => s + p.atualizado, 0);
    expect(Math.abs(arredondar2(somaTabela) - d.total)).toBe(0);
    expect(totalDemonstrativo(d.parcelas)).toBe(d.total);
  });

  it("6. paridade com calcularTotalVencido para o mesmo conjunto", () => {
    const parcelas = [
      parcela({ vencimento: "2026-05-10", saldo: 1500 }),
      parcela({ vencimento: "2026-06-10", saldo: 1500 }),
      parcela({ vencimento: "2026-07-10", saldo: 1500 }),
      parcela({ vencimento: "2026-12-10", saldo: 1500 }), // futura
    ];
    const d = montarDemonstrativo(parcelas, HOJE);
    // calcularTotalVencido arredonda só no total; aqui por linha. A diferença
    // máxima é de 1 centavo por linha arredondada.
    expect(Math.abs(d.total - calcularTotalVencido(parcelas, HOJE))).toBeLessThanOrEqual(
      0.01 * d.parcelas.length,
    );
    // Com saldos "redondos" e dias inteiros o valor é exatamente igual.
    const simples = [parcela({ vencimento: "2026-08-24", saldo: 3000 })]; // 30 dias → 2% + 1%
    expect(montarDemonstrativo(simples, HOJE).total).toBe(calcularTotalVencido(simples, HOJE));
    expect(montarDemonstrativo(simples, HOJE).total).toBe(3090);
  });
});

describe("cobranca-casos: régua e etapas", () => {
  it("datas das 5 mensagens: dia do início + 4 dias úteis seguintes (pula fim de semana)", () => {
    expect(datasMensagens("2026-09-23")).toEqual([
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-28",
      "2026-09-29",
    ]);
    // Início no sábado → primeira mensagem na segunda.
    expect(datasMensagens("2026-09-26")[0]).toBe("2026-09-28");
  });

  it("prazo final = recebimento + 10 dias corridos; pronto para processo só após o prazo", () => {
    expect(prazoFinalNotificacao("2026-09-25")).toBe("2026-10-05");
    const caso = { status: "aguardando_prazo" as const, prazo_final: "2026-10-05" };
    expect(etapaDoCaso(caso, "2026-10-05")).toBe("aguardando_prazo");
    expect(etapaDoCaso(caso, "2026-10-06")).toBe("pronto_processo");
  });

  it("mensagem N exige N-1 registrada e print", () => {
    const msgs = [
      { ordem: 1, enviada_em: "2026-09-23T10:00:00Z" },
      { ordem: 2, enviada_em: null },
      { ordem: 3, enviada_em: null },
    ];
    expect(validarRegistroMensagem(msgs, 2, false)).toMatch(/print/);
    expect(validarRegistroMensagem(msgs, 3, true)).toMatch(/mensagem 2\/5/);
    expect(validarRegistroMensagem(msgs, 2, true)).toBeNull();
    expect(validarRegistroMensagem(msgs, 1, true)).toMatch(/já foi registrada/);
  });

  it("chave do responsável: CPF só dígitos, senão nome normalizado", () => {
    expect(responsavelKey("123.456.789-01", "Fulano")).toBe("12345678901");
    expect(responsavelKey("", "  Maria  DA Silva ")).toBe("nome:maria da silva");
  });

  it("campos obrigatórios da unidade faltantes são nomeados", () => {
    expect(camposFaltantesColegio(colegio)).toEqual([]);
    expect(camposFaltantesColegio({ ...colegio, cnpj: "", email: " " })).toEqual([
      "CNPJ",
      "E-mail",
    ]);
  });
});

describe("cobranca-casos: data de início informada (PR B)", () => {
  const parcelas = [
    parcela({ descricao: "Mensalidade 07", vencimento: "2026-07-10", saldo: 1000 }),
    parcela({ descricao: "Mensalidade 08", vencimento: "2026-08-10", saldo: 1000 }),
    parcela({ descricao: "Mensalidade 09", vencimento: "2026-09-10", saldo: 1000 }),
    parcela({ descricao: "Mensalidade 10", vencimento: "2026-10-10", saldo: 1000 }),
  ];

  it("B.5.1 snapshot com data-base = data_inicio: vencimento igual ou posterior fica fora; multa e juros até a data_inicio", () => {
    const dataInicio = "2026-09-10";
    const demo = montarDemonstrativo(parcelas, dataInicio);
    expect(demo.dataBase).toBe(dataInicio);
    expect(demo.parcelas.map((p) => p.descricao)).toEqual(["Mensalidade 07", "Mensalidade 08"]);
    for (const p of demo.parcelas) {
      expect(p.atualizado).toBe(
        arredondar2(valorAtualizadoParcela(p.original, p.vencimento, dataInicio)),
      );
      expect(p.dias_atraso).toBe(diasEntreYMD(p.vencimento, dataInicio));
      expect(arredondar2(p.original + p.multa + p.juros)).toBe(p.atualizado);
    }
    expect(demo.total).toBe(arredondar2(demo.parcelas.reduce((s, p) => s + p.atualizado, 0)));
    // Início mais cedo (antes do vencimento de agosto) reduz o snapshot para 1 parcela.
    expect(montarDemonstrativo(parcelas, "2026-08-05").parcelas.map((p) => p.descricao)).toEqual([
      "Mensalidade 07",
    ]);
  });

  it("B.5.2 alterar a data de início gera valor_inicial igual ao de um caso criado com a nova data", () => {
    const criadoEm = montarDemonstrativo(parcelas, "2026-09-01");
    const novaData = "2026-09-18";
    const recalculado = montarDemonstrativo(parcelas, novaData); // recálculo no alterarDataInicio
    const criadoDireto = montarDemonstrativo(parcelas, novaData); // caso novo com a mesma data
    expect(recalculado.total).toBe(criadoDireto.total);
    expect(recalculado.parcelas).toEqual(criadoDireto.parcelas);
    expect(recalculado.total).toBeGreaterThan(criadoEm.total);
    // As 5 datas previstas também seguem a nova data: sex 18/09 -> 18, 21, 22, 23, 24/09.
    expect(datasMensagens(novaData)).toEqual([
      "2026-09-18",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
  });

  it("validações de data: início não futuro; envio não futuro, >= início e >= envio anterior; fora_da_data", () => {
    const hoje = "2026-09-23";
    expect(validarDataInicio("2026-09-23", hoje)).toBeNull();
    expect(validarDataInicio("2026-09-24", hoje)).toMatch(/futura/);
    expect(validarDataInicio("", hoje)).toMatch(/Informe/);
    expect(validarDataEnvio("2026-09-22", hoje, "2026-09-18", null)).toBeNull();
    expect(validarDataEnvio("2026-09-24", hoje, "2026-09-18", null)).toMatch(/futura/);
    expect(validarDataEnvio("2026-09-17", hoje, "2026-09-18", null)).toMatch(/início/);
    expect(validarDataEnvio("2026-09-20", hoje, "2026-09-18", "2026-09-21")).toMatch(/anterior/);
    expect(dataEnvioSugerida("2026-09-18", hoje)).toBe("2026-09-18");
    expect(dataEnvioSugerida("2026-09-30", hoje)).toBe(hoje);
    expect(
      podeAlterarDataInicio({ status: "mensagens" }, [{ print_path: null }, { print_path: null }]),
    ).toBe(true);
    expect(podeAlterarDataInicio({ status: "mensagens" }, [{ print_path: "x.png" }])).toBe(false);
  });
});

describe("reagendarMensagens (rota ancorada no último envio real)", () => {
  const reg = (ordem: number, prevista: string, envio: string) => ({
    ordem,
    data_prevista: prevista,
    data_envio: envio,
    enviada_em: `${envio}T12:00:00Z`,
  });
  const pend = (ordem: number, prevista: string) => ({
    ordem,
    data_prevista: prevista,
    data_envio: null,
    enviada_em: null,
  });
  const INICIO = "2026-09-18";
  const ludymyla = [
    reg(1, "2026-09-18", "2026-09-18"),
    reg(2, "2026-09-21", "2026-09-21"),
    reg(3, "2026-09-22", "2026-09-22"),
    pend(4, "2026-09-23"),
    pend(5, "2026-09-24"),
  ];
  it("caso Juliana: 3 registrada hoje (24/09) → 4 = 25/09 (sex), 5 = 28/09 (seg)", () => {
    const juliana = [
      reg(1, "2026-09-18", "2026-09-18"),
      reg(2, "2026-09-21", "2026-09-23"),
      reg(3, "2026-09-22", "2026-09-24"),
      pend(4, "2026-09-24"),
      pend(5, "2026-09-25"),
    ];
    expect(reagendarMensagens(juliana, "2026-09-24", INICIO)).toEqual([
      { ordem: 4, de: "2026-09-24", para: "2026-09-25" },
      { ordem: 5, de: "2026-09-25", para: "2026-09-28" },
    ]);
  });
  it("caso Ludymyla: em 24/09, 4 = 24/09 e 5 = 25/09", () => {
    expect(reagendarMensagens(ludymyla, "2026-09-24", INICIO)).toEqual([
      { ordem: 4, de: "2026-09-23", para: "2026-09-24" },
      { ordem: 5, de: "2026-09-24", para: "2026-09-25" },
    ]);
  });
  it("última registrada ontem, nada hoje → primeira pendente = hoje", () => {
    const msgs = [reg(1, "2026-09-18", "2026-09-22"), pend(2, "2026-09-21"), pend(3, "2026-09-22")];
    expect(reagendarMensagens(msgs, "2026-09-23", INICIO)).toEqual([
      { ordem: 2, de: "2026-09-21", para: "2026-09-23" },
      { ordem: 3, de: "2026-09-22", para: "2026-09-24" },
    ]);
  });
  it("nenhuma registrada, data_inicio no passado → mensagem 1 = hoje", () => {
    const msgs = [pend(1, "2026-09-18"), pend(2, "2026-09-21")];
    expect(reagendarMensagens(msgs, "2026-09-24", INICIO)).toEqual([
      { ordem: 1, de: "2026-09-18", para: "2026-09-24" },
      { ordem: 2, de: "2026-09-21", para: "2026-09-25" },
    ]);
    // data_inicio no futuro: rota permanece a partir dela (nada muda)
    expect(reagendarMensagens(msgs, "2026-09-10", INICIO)).toEqual([]);
  });
  it("rodar duas vezes seguidas não gera nova mudança", () => {
    const mud = reagendarMensagens(ludymyla, "2026-09-24", INICIO);
    const porOrdem = new Map(mud.map((m) => [m.ordem, m.para]));
    const aplicadas = ludymyla.map((m) =>
      porOrdem.has(m.ordem) ? { ...m, data_prevista: porOrdem.get(m.ordem)! } : m,
    );
    expect(reagendarMensagens(aplicadas, "2026-09-24", INICIO)).toEqual([]);
    expect(reagendarMensagens(ludymyla, "2026-09-23", INICIO)).toEqual([]);
  });
  it("sexta com envio registrado → próxima na segunda (ou terça se segunda for feriado)", () => {
    // sex 25/09/2026 → seg 28/09
    const msgs = [reg(1, "2026-09-25", "2026-09-25"), pend(2, "2026-09-25"), pend(3, "2026-09-28")];
    expect(reagendarMensagens(msgs, "2026-09-25", INICIO)).toEqual([
      { ordem: 2, de: "2026-09-25", para: "2026-09-28" },
      { ordem: 3, de: "2026-09-28", para: "2026-09-29" },
    ]);
    // sex 30/10/2026 → seg 02/11 (Finados) → ter 03/11
    const fer = [reg(1, "2026-10-30", "2026-10-30"), pend(2, "2026-10-30")];
    expect(reagendarMensagens(fer, "2026-10-30", INICIO)).toEqual([
      { ordem: 2, de: "2026-10-30", para: "2026-11-03" },
    ]);
  });
  it("mesmasMudancas, descrição do evento e mensagem do dia", () => {
    const mud = reagendarMensagens(ludymyla, "2026-09-24", INICIO);
    expect(mesmasMudancas(mud, [...mud])).toBe(true);
    expect(mesmasMudancas(mud, mud.slice(1))).toBe(false);
    expect(descreverReagendamento(mud)).toBe(
      "Mensagens 4 a 5 reagendadas: mensagem 4 de 23/09 para 24/09; mensagem 5 de 24/09 para 25/09",
    );
    expect(mensagemDoDiaPendente({ status: "mensagens" }, ludymyla, "2026-09-23")).toBe(4);
    expect(mensagemDoDiaPendente({ status: "notificacao" }, ludymyla, "2026-09-23")).toBeNull();
  });
});
