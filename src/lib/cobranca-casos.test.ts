import { describe, expect, it } from "vitest";

import { calcularTotalVencido, valorAtualizadoParcela } from "@/lib/billing-debt";
import {
  arredondar2,
  atualizarParcela,
  datasMensagens,
  etapaDoCaso,
  montarDemonstrativo,
  prazoFinalNotificacao,
  responsavelKey,
  totalDemonstrativo,
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
