import { describe, expect, it } from "vitest";
import {
  AVISO_SENSIVEL,
  LIMITE_EDICAO_SIGNIFICATIVA,
  MAX_MENSAGENS_CONTEXTO,
  PROMPT_PADRAO,
  blocoFinanceiro,
  classificarSituacao,
  competenciaDeIso,
  contarSugestoesDoMes,
  detectarAssuntoSensivel,
  edicaoSignificativa,
  grauDeEdicao,
  limitarHistorico,
  montarAtualizacaoEnvio,
  montarPromptIA,
  montarRegistroSugestao,
  resumirContexto,
  textoDaMensagem,
  textosEquivalentes,
  ultimaDoResponsavel,
  type FinanceiroContexto,
  type MensagemContexto,
} from "./atendimento-ia";

const HOJE = "2026-08-19";

function msg(
  direcao: "in" | "out",
  corpo: string,
  extra: Partial<MensagemContexto> = {},
): MensagemContexto {
  return { direcao, corpo, tipo: "text", automatica: false, ...extra };
}

function financeiro(over: Partial<FinanceiroContexto> = {}): FinanceiroContexto {
  return {
    alunoNome: "Ana Souza",
    alunoId: "1234",
    unidade: "CEC",
    responsavelNome: "Marcos Souza",
    parcelas: [
      { vencimento: "2026-07-10", saldo: 1200 },
      { vencimento: "2026-09-10", saldo: 1200 },
    ],
    totalVencido: 1236.4,
    acordoMes: null,
    consultaOk: true,
    ...over,
  };
}

describe("histórico da conversa no contexto", () => {
  it("descarta notas de sistema e mensagens vazias", () => {
    const historico = limitarHistorico([
      msg("in", "Bom dia"),
      msg("in", "", { tipo: "system" }),
      msg("in", "Número trocado", { tipo: "system" }),
      msg("out", "   "),
      msg("out", "Bom dia!"),
    ]);
    expect(historico.map((m) => m.corpo)).toEqual(["Bom dia", "Bom dia!"]);
  });

  it("mantém apenas as últimas mensagens, em ordem cronológica", () => {
    const muitas = Array.from({ length: 40 }, (_, i) => msg("in", `m${i}`));
    const historico = limitarHistorico(muitas);
    expect(historico).toHaveLength(MAX_MENSAGENS_CONTEXTO);
    expect(historico[0].corpo).toBe("m10");
    expect(historico[historico.length - 1].corpo).toBe("m39");
  });

  it("representa mídia por marcador, sem inventar conteúdo", () => {
    expect(textoDaMensagem(msg("in", "", { tipo: "image" }))).toBe("[imagem anexada]");
    expect(textoDaMensagem(msg("in", "comprovante", { tipo: "document" }))).toBe(
      "[documento anexado] comprovante",
    );
    expect(textoDaMensagem(msg("in", "", { tipo: "audio" }))).toContain("não transcrito");
  });

  it("acha a última mensagem do responsável, ignorando as da escola", () => {
    const ultima = ultimaDoResponsavel([
      msg("in", "primeira"),
      msg("in", "segunda"),
      msg("out", "resposta da escola"),
    ]);
    expect(ultima?.corpo).toBe("segunda");
  });
});

describe("classificação da situação", () => {
  const casos: [string, string][] = [
    ["Consigo parcelar esse valor em duas vezes?", "acordo"],
    ["Por que o valor está diferente do combinado?", "valor"],
    ["Já paguei essa mensalidade, segue o comprovante", "comprovante"],
    ["Preciso da segunda via do boleto", "boleto"],
    ["Isso é um absurdo, vou procurar meu advogado", "reclamacao"],
    ["A professora falou que ele mordeu um coleguinha", "pedagogico"],
    ["Bom dia, tudo bem?", "outro"],
  ];

  for (const [texto, esperado] of casos) {
    it(`"${texto}" → ${esperado}`, () => {
      expect(classificarSituacao([msg("out", "Olá"), msg("in", texto)])).toBe(esperado);
    });
  }

  it("classifica pela última fala do responsável, não pela da escola", () => {
    expect(
      classificarSituacao([msg("in", "quero parcelar"), msg("out", "vou verificar o boleto")]),
    ).toBe("acordo");
  });

  it("ignora acentuação e caixa", () => {
    expect(classificarSituacao([msg("in", "PRECISO DE UM ACÔRDO")])).toBe("acordo");
    expect(classificarSituacao([msg("in", "Isso é INACEITÁVEL")])).toBe("reclamacao");
    expect(classificarSituacao([msg("in", "Vou na JUSTIÇA")])).toBe("reclamacao");
  });
});

describe("assunto sensível", () => {
  it("sinaliza ameaça de ação legal", () => {
    const t = detectarAssuntoSensivel([msg("in", "Vou processar a escola por isso")]);
    expect(t.sensivel).toBe(true);
    expect(t.motivo).toContain("legal");
  });

  it("sinaliza assunto pedagógico/disciplinar", () => {
    const t = detectarAssuntoSensivel([msg("in", "Quero falar com a coordenacao sobre a turma")]);
    expect(t.sensivel).toBe(true);
    expect(t.motivo).toContain("pedagógico");
  });

  it("não sinaliza cobrança comum", () => {
    expect(detectarAssuntoSensivel([msg("in", "Pode me mandar o boleto?")])).toEqual({
      sensivel: false,
      motivo: "",
    });
  });

  it("registro de caso sensível guarda o aviso em vez de um rascunho", () => {
    const mensagens = [msg("in", "Vou no Procon amanhã")];
    const triagem = detectarAssuntoSensivel(mensagens);
    const registro = montarRegistroSugestao({
      conversationId: "c1",
      alunoId: "1234",
      unidade: "CEC",
      mensagens,
      triagem,
      sugestao: `${AVISO_SENSIVEL} Motivo: ${triagem.motivo}.`,
      modelo: "",
      tokensEntrada: 0,
      tokensSaida: 0,
      userId: "u1",
    });
    expect(registro.sensivel).toBe(true);
    expect(registro.sugestao).toContain(AVISO_SENSIVEL);
    expect(registro.modelo).toBe("");
    expect(registro.tokens_entrada).toBe(0);
  });
});

describe("bloco financeiro do Sponte", () => {
  it("lista cada parcela com valor e vencimento e separa vencidas de a vencer", () => {
    const bloco = blocoFinanceiro(financeiro(), HOJE);
    expect(bloco).toContain("10/07/2026");
    expect(bloco).toContain("R$ 1.200,00");
    expect(bloco).toContain("vencida");
    expect(bloco).toContain("a vencer");
    expect(bloco).toContain("1 parcela(s) vencida(s), 1 a vencer");
  });

  it("traz o total vencido e a regra do desconto de pontualidade", () => {
    const bloco = blocoFinanceiro(financeiro(), HOJE);
    expect(bloco).toContain("R$ 1.236,40");
    expect(bloco).toContain("sem desconto de pontualidade");
  });

  it("informa o acordo registrado e o mês de referência", () => {
    const bloco = blocoFinanceiro(financeiro({ acordoMes: "2026-07" }), HOJE);
    expect(bloco).toContain("Acordo de parcelamento registrado");
    expect(bloco).toContain("2026-07");
  });

  it("diz explicitamente quando não há acordo", () => {
    expect(blocoFinanceiro(financeiro(), HOJE)).toContain("Nenhum acordo de parcelamento");
  });

  it("sem débito em aberto, afirma que não há débito", () => {
    const bloco = blocoFinanceiro(financeiro({ parcelas: [], totalVencido: 0 }), HOJE);
    expect(bloco).toContain("nenhuma");
    expect(bloco).not.toContain("Total vencido");
  });

  it("consulta indisponível proíbe citar valores e não vaza número nenhum", () => {
    const bloco = blocoFinanceiro(
      financeiro({ consultaOk: false, parcelas: [], totalVencido: 0 }),
      HOJE,
    );
    expect(bloco).toContain("NÃO cite valores");
    expect(bloco).not.toContain("R$");
  });
});

describe("montagem do prompt enviado à IA", () => {
  const mensagens = [
    msg("out", "Olá! Consta uma parcela em aberto.", { automatica: true }),
    msg("in", "Qual o valor atualizado?"),
  ];

  it("usa as instruções configuradas e anexa a situação financeira", () => {
    const prompt = montarPromptIA({
      instrucoes: "Responda sempre em duas frases.",
      financeiro: financeiro(),
      mensagens,
      hojeYMD: HOJE,
    });
    expect(prompt.system).toContain("Responda sempre em duas frases.");
    expect(prompt.system).toContain("Situação financeira (Sponte)");
    expect(prompt.system).toContain("R$ 1.236,40");
    expect(prompt.system).toContain("Ana Souza");
    expect(prompt.system).toContain("Marcos Souza");
  });

  it("cai no prompt padrão quando as instruções estão vazias", () => {
    const prompt = montarPromptIA({
      instrucoes: "   ",
      financeiro: financeiro(),
      mensagens,
      hojeYMD: HOJE,
    });
    expect(prompt.system.startsWith(PROMPT_PADRAO)).toBe(true);
  });

  it("mapeia o responsável para user e a escola para assistant", () => {
    const prompt = montarPromptIA({
      instrucoes: PROMPT_PADRAO,
      financeiro: financeiro(),
      mensagens,
      hojeYMD: HOJE,
    });
    expect(prompt.mensagens[0].role).toBe("user");
    expect(prompt.mensagens.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(prompt.mensagens[1].content).toContain("[mensagem automática de cobrança]");
    expect(prompt.mensagens[2].content).toBe("Qual o valor atualizado?");
  });

  it("garante primeiro turno do usuário quando a conversa começa pela escola", () => {
    const prompt = montarPromptIA({
      instrucoes: PROMPT_PADRAO,
      financeiro: financeiro(),
      mensagens: [msg("out", "Bom dia, segue o boleto.")],
      hojeYMD: HOJE,
    });
    expect(prompt.mensagens[0].role).toBe("user");
    expect(prompt.mensagens[0].content).toContain("sem mensagem anterior");
  });

  it("nunca manda conversa vazia à API", () => {
    const prompt = montarPromptIA({
      instrucoes: PROMPT_PADRAO,
      financeiro: financeiro(),
      mensagens: [],
      hojeYMD: HOJE,
    });
    expect(prompt.mensagens).toHaveLength(1);
    expect(prompt.mensagens[0].role).toBe("user");
  });

  it("respeita o teto de mensagens para conter o custo por token", () => {
    const muitas = Array.from({ length: 50 }, (_, i) =>
      msg(i % 2 === 0 ? "in" : "out", `linha ${i}`),
    );
    const prompt = montarPromptIA({
      instrucoes: PROMPT_PADRAO,
      financeiro: financeiro(),
      mensagens: muitas,
      hojeYMD: HOJE,
      maxMensagens: 6,
    });
    expect(prompt.mensagens).toHaveLength(6);
    expect(prompt.mensagens[prompt.mensagens.length - 1].content).toBe("linha 49");
  });

  it("proíbe inventar dados: a regra está no prompt padrão", () => {
    expect(PROMPT_PADRAO).toContain("Nunca calcule, estime ou invente");
    expect(PROMPT_PADRAO).toContain("valor CHEIO do boleto");
  });
});

describe("registro da sugestão", () => {
  const mensagens = [msg("out", "Segue o boleto"), msg("in", "Consigo um acordo?")];

  it("guarda conversa, aluno, situação e autoria, com resumo do contexto", () => {
    const registro = montarRegistroSugestao({
      conversationId: "c-1",
      alunoId: "1234",
      unidade: "CEC",
      mensagens,
      triagem: { sensivel: false, motivo: "" },
      sugestao: "Claro, podemos avaliar.",
      modelo: "claude-sonnet-4-5",
      tokensEntrada: 900,
      tokensSaida: 120,
      userId: "u-1",
    });
    expect(registro).toMatchObject({
      conversation_id: "c-1",
      aluno_id: "1234",
      unidade: "CEC",
      situacao: "acordo",
      sensivel: false,
      sugestao: "Claro, podemos avaliar.",
      modelo: "claude-sonnet-4-5",
      tokens_entrada: 900,
      tokens_saida: 120,
      gerado_por: "u-1",
    });
    expect(registro.contexto_resumo).toContain("Pedido de acordo");
    expect(registro.contexto_resumo).toContain("Consigo um acordo?");
  });

  it("conversa sem aluno vinculado grava aluno nulo", () => {
    const registro = montarRegistroSugestao({
      conversationId: "c-2",
      alunoId: null,
      unidade: "",
      mensagens,
      triagem: { sensivel: false, motivo: "" },
      sugestao: "texto",
      modelo: "m",
      tokensEntrada: 0,
      tokensSaida: 0,
      userId: "u-1",
    });
    expect(registro.aluno_id).toBeNull();
  });

  it("resumo do contexto conta as mensagens e corta a última fala", () => {
    const longa = "x".repeat(400);
    const resumo = resumirContexto([msg("out", "a"), msg("in", longa)]);
    expect(resumo).toContain("2 mensagem(ns)");
    expect(resumo).toContain("x".repeat(280));
    expect(resumo).not.toContain("x".repeat(281));
  });
});

describe("par sugestão-original / versão-final", () => {
  const sugestao = "Olá, Marcos! Consta a parcela de julho em aberto, no valor de R$ 1.236,40.";

  it("envio literal fecha o par sem marcar edição", () => {
    const at = montarAtualizacaoEnvio(sugestao, sugestao, "2026-08-19T12:00:00.000Z");
    expect(at).toEqual({
      enviado_body: sugestao,
      enviado_em: "2026-08-19T12:00:00.000Z",
      editado: false,
    });
  });

  it("reindentação não conta como edição", () => {
    const at = montarAtualizacaoEnvio(
      sugestao,
      `  ${sugestao.replace(/ /g, "  ")}\n`,
      "2026-08-19T12:00:00.000Z",
    );
    expect(at.editado).toBe(false);
    expect(textosEquivalentes(sugestao, ` ${sugestao} `)).toBe(true);
  });

  it("texto ajustado à mão é gravado como editado, preservando o original", () => {
    const enviado = "Oi Marcos, tudo bem? A parcela de julho está em aberto: R$ 1.236,40.";
    const at = montarAtualizacaoEnvio(sugestao, enviado, "2026-08-19T12:00:00.000Z");
    expect(at.editado).toBe(true);
    expect(at.enviado_body).toBe(enviado);
  });

  it("mede o grau de edição entre idêntico e reescrito do zero", () => {
    expect(grauDeEdicao(sugestao, sugestao)).toBe(0);
    expect(
      grauDeEdicao(sugestao, "Bom dia, retorno em instantes com a informação."),
    ).toBeGreaterThan(0.7);
  });

  it("edição significativa: pontuação trocada não vale, reescrita vale", () => {
    expect(edicaoSignificativa(sugestao, `${sugestao}!`)).toBe(false);
    expect(edicaoSignificativa(sugestao, "Marcos, te ligo agora para resolvermos isso.")).toBe(
      true,
    );
    expect(LIMITE_EDICAO_SIGNIFICATIVA).toBeGreaterThan(0);
  });
});

describe("contador de uso do mês", () => {
  it("conta por competência no fuso de São Paulo", () => {
    // 01/09 00:30 UTC ainda é 31/08 em São Paulo (UTC-3).
    expect(competenciaDeIso("2026-09-01T00:30:00.000Z")).toBe("2026-08");
    expect(competenciaDeIso("2026-09-01T05:00:00.000Z")).toBe("2026-09");
  });

  it("conta só as sugestões da competência pedida", () => {
    const sugestoes = [
      { gerado_em: "2026-08-01T13:00:00.000Z" },
      { gerado_em: "2026-08-31T20:00:00.000Z" },
      { gerado_em: "2026-09-01T13:00:00.000Z" },
      { gerado_em: "2026-07-15T13:00:00.000Z" },
    ];
    expect(contarSugestoesDoMes(sugestoes, "2026-08")).toBe(2);
    expect(contarSugestoesDoMes(sugestoes, "2026-09")).toBe(1);
    expect(contarSugestoesDoMes(sugestoes, "2026-10")).toBe(0);
  });

  it("timestamp inválido não entra na contagem", () => {
    expect(contarSugestoesDoMes([{ gerado_em: "não é data" }], "2026-08")).toBe(0);
  });
});
