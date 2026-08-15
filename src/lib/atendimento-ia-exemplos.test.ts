import { describe, it, expect } from "vitest";
import {
  MAX_EXEMPLOS_CONTEXTO,
  blocoExemplos,
  montarRegistroExemplo,
  palavrasChave,
  palavrasEmComum,
  pontuarExemplo,
  selecionarExemplos,
  type ExemploTreinamento,
} from "./atendimento-ia-exemplos";
import { montarPromptIA, type FinanceiroContexto, type MensagemContexto } from "./atendimento-ia";

function msg(
  direcao: "in" | "out",
  corpo: string,
  extra: Partial<MensagemContexto> = {},
): MensagemContexto {
  return { direcao, corpo, tipo: "text", automatica: false, ...extra };
}

function exemplo(over: Partial<ExemploTreinamento> = {}): ExemploTreinamento {
  return {
    id: "e1",
    situacao: "outro",
    contexto: "",
    sugestao_original: "",
    resposta_final: "Resposta padrão.",
    ativo: true,
    criado_em: "2026-08-01T12:00:00.000Z",
    ...over,
  };
}

const FINANCEIRO: FinanceiroContexto = {
  alunoNome: "Ana Souza",
  alunoId: "10",
  unidade: "CEC",
  responsavelNome: "Marcos Souza",
  parcelas: [{ vencimento: "2026-08-05", saldo: 1200 }],
  totalVencido: 1250,
  acordoMes: null,
  consultaOk: true,
};

describe("palavrasChave", () => {
  it("descarta acento, palavra curta, número solto e palavra sem sentido próprio", () => {
    const p = palavrasChave("Bom dia, não consigo pagar a mensalidade de 1200 este mês");
    expect(p.has("mensalidade")).toBe(true);
    expect(p.has("consigo")).toBe(true);
    expect(p.has("dia")).toBe(false); // stopword
    expect(p.has("mes")).toBe(false); // curta demais
    expect(p.has("1200")).toBe(false); // número
    expect(p.has("este")).toBe(false);
  });

  it("normaliza acentuação para comparar palavras escritas de formas diferentes", () => {
    expect(palavrasEmComum(palavrasChave("parcelamento"), palavrasChave("PARCELAMENTO"))).toBe(1);
    expect(palavrasEmComum(palavrasChave("negociação"), palavrasChave("negociacao"))).toBe(1);
  });
});

describe("pontuarExemplo", () => {
  it("pesa mais a mesma situação do que palavras em comum", () => {
    const alvo = {
      situacao: "acordo" as const,
      palavras: palavrasChave("boleto vencido mensalidade"),
    };
    const mesmaSituacao = pontuarExemplo(exemplo({ situacao: "acordo" }), alvo);
    const outraSituacaoComPalavras = pontuarExemplo(
      exemplo({ situacao: "boleto", contexto: "boleto vencido", resposta_final: "mensalidade" }),
      alvo,
    );
    expect(mesmaSituacao).toBeGreaterThan(outraSituacaoComPalavras);
  });

  it("soma as palavras em comum do contexto e da resposta final", () => {
    const alvo = {
      situacao: "comprovante" as const,
      palavras: palavrasChave("comprovante transferencia"),
    };
    const semNada = pontuarExemplo(exemplo({ situacao: "boleto" }), alvo);
    const comDuas = pontuarExemplo(
      exemplo({
        situacao: "boleto",
        contexto: "mandou comprovante",
        resposta_final: "recebi a transferencia",
      }),
      alvo,
    );
    expect(semNada).toBe(0);
    expect(comDuas).toBe(2);
  });
});

describe("selecionarExemplos", () => {
  const mensagens = [
    msg("out", "Bom dia! Passando o boleto de agosto."),
    msg("in", "Estou desempregado, consigo parcelar a mensalidade?"),
  ];

  it("prioriza exemplos da mesma situação da conversa atual", () => {
    const escolhidos = selecionarExemplos(
      [
        exemplo({ id: "boleto", situacao: "boleto" }),
        exemplo({ id: "acordo", situacao: "acordo" }),
        exemplo({ id: "valor", situacao: "valor" }),
      ],
      { mensagens, max: 1 },
    );
    expect(escolhidos.map((e) => e.id)).toEqual(["acordo"]);
  });

  it("desempata pelo mais recente quando a relevância é igual", () => {
    const escolhidos = selecionarExemplos(
      [
        exemplo({ id: "antigo", situacao: "acordo", criado_em: "2026-01-10T10:00:00.000Z" }),
        exemplo({ id: "novo", situacao: "acordo", criado_em: "2026-08-10T10:00:00.000Z" }),
      ],
      { mensagens, max: 1 },
    );
    expect(escolhidos.map((e) => e.id)).toEqual(["novo"]);
  });

  it("usa palavras em comum para escolher entre exemplos da mesma situação", () => {
    const escolhidos = selecionarExemplos(
      [
        exemplo({
          id: "generico",
          situacao: "acordo",
          contexto: "pediu prazo",
          criado_em: "2026-08-10T10:00:00.000Z",
        }),
        exemplo({
          id: "parecido",
          situacao: "acordo",
          contexto: "responsavel desempregado pediu para parcelar a mensalidade",
          criado_em: "2026-01-10T10:00:00.000Z",
        }),
      ],
      { mensagens, max: 1 },
    );
    expect(escolhidos.map((e) => e.id)).toEqual(["parecido"]);
  });

  it("ignora exemplos inativos e sem resposta final", () => {
    const escolhidos = selecionarExemplos(
      [
        exemplo({ id: "inativo", situacao: "acordo", ativo: false }),
        exemplo({ id: "vazio", situacao: "acordo", resposta_final: "   " }),
        exemplo({ id: "valido", situacao: "acordo" }),
      ],
      { mensagens },
    );
    expect(escolhidos.map((e) => e.id)).toEqual(["valido"]);
  });

  it("respeita o teto de exemplos e o padrão da biblioteca", () => {
    const muitos = Array.from({ length: 10 }, (_, i) =>
      exemplo({
        id: `e${i}`,
        situacao: "acordo",
        criado_em: `2026-08-0${(i % 9) + 1}T10:00:00.000Z`,
      }),
    );
    expect(selecionarExemplos(muitos, { mensagens })).toHaveLength(MAX_EXEMPLOS_CONTEXTO);
    expect(selecionarExemplos(muitos, { mensagens, max: 2 })).toHaveLength(2);
    expect(selecionarExemplos(muitos, { mensagens, max: 0 })).toHaveLength(0);
  });

  it("funciona em conversa sem mensagem do responsável (cai em 'outro')", () => {
    const escolhidos = selecionarExemplos([exemplo({ id: "generico" })], {
      mensagens: [msg("out", "Boa tarde, segue o boleto.")],
    });
    expect(escolhidos.map((e) => e.id)).toEqual(["generico"]);
  });

  it("não devolve nada quando a biblioteca está vazia", () => {
    expect(selecionarExemplos([], { mensagens })).toEqual([]);
  });
});

describe("blocoExemplos", () => {
  it("é vazio sem exemplos, para não inflar o prompt", () => {
    expect(blocoExemplos([])).toBe("");
  });

  it("numera os exemplos, traz a resposta enviada e proíbe copiar valores", () => {
    const bloco = blocoExemplos([
      exemplo({ situacao: "acordo", contexto: "pediu parcelamento", resposta_final: "Claro!" }),
      exemplo({ id: "e2", situacao: "boleto", resposta_final: "Segue a segunda via." }),
    ]);
    expect(bloco).toContain("Exemplo 1 — Pedido de acordo/parcelamento");
    expect(bloco).toContain("Contexto: pediu parcelamento");
    expect(bloco).toContain("Resposta enviada pela escola: Claro!");
    expect(bloco).toContain("Exemplo 2 — Segunda via de boleto");
    expect(bloco).toContain("nunca copie valores, datas ou nomes");
  });
});

describe("montarPromptIA com exemplos", () => {
  const mensagens = [msg("in", "Consigo parcelar?")];

  it("insere o bloco few-shot entre as instruções e a situação financeira", () => {
    const prompt = montarPromptIA({
      instrucoes: "Regras gerais.",
      financeiro: FINANCEIRO,
      mensagens,
      hojeYMD: "2026-08-19",
      exemplos: blocoExemplos([exemplo({ resposta_final: "Vou verificar com a coordenação." })]),
    });
    const posRegras = prompt.system.indexOf("Regras gerais.");
    const posExemplos = prompt.system.indexOf("Exemplos de treinamento");
    const posFinanceiro = prompt.system.indexOf("Situação financeira (Sponte)");
    expect(posRegras).toBeLessThan(posExemplos);
    expect(posExemplos).toBeLessThan(posFinanceiro);
    expect(prompt.system).toContain("Vou verificar com a coordenação.");
  });

  it("não cria a seção quando não há exemplo relevante", () => {
    const prompt = montarPromptIA({
      instrucoes: "Regras gerais.",
      financeiro: FINANCEIRO,
      mensagens,
      hojeYMD: "2026-08-19",
      exemplos: blocoExemplos([]),
    });
    expect(prompt.system).not.toContain("Exemplos de treinamento");
    expect(prompt.system).toContain("Situação financeira (Sponte)");
  });

  it("mantém os valores do Sponte como única fonte financeira", () => {
    const prompt = montarPromptIA({
      instrucoes: "Regras gerais.",
      financeiro: FINANCEIRO,
      mensagens,
      hojeYMD: "2026-08-19",
      exemplos: blocoExemplos([exemplo({ resposta_final: "O valor é R$ 999,00." })]),
    });
    expect(prompt.system).toContain("R$ 1.200,00");
    expect(prompt.system).toContain("nunca copie valores");
  });
});

describe("montarRegistroExemplo", () => {
  const mensagens = [
    msg("out", "Segue o boleto de agosto."),
    msg("in", "Não consigo pagar agora, dá para negociar?"),
  ];

  it("guarda o par sugestão-original/versão-final com situação e contexto", () => {
    const registro = montarRegistroExemplo({
      suggestionId: "s1",
      conversationId: "c1",
      alunoId: "10",
      unidade: "CEC",
      mensagens,
      sugestaoOriginal: "  Podemos parcelar em duas vezes.  ",
      respostaFinal: "  Consigo dividir em duas vezes, tudo bem?  ",
      userId: "u1",
      userNome: "Sérgio",
    });
    expect(registro.situacao).toBe("acordo");
    expect(registro.sugestao_original).toBe("Podemos parcelar em duas vezes.");
    expect(registro.resposta_final).toBe("Consigo dividir em duas vezes, tudo bem?");
    expect(registro.contexto).toContain("Pedido de acordo/parcelamento");
    expect(registro.contexto).toContain("dá para negociar?");
    expect(registro.ativo).toBe(true);
    expect(registro.criado_por).toBe("u1");
    expect(registro.criado_por_nome).toBe("Sérgio");
    expect(registro.suggestion_id).toBe("s1");
  });

  it("aceita resposta escrita do zero (sem sugestão) sem perder o exemplo", () => {
    const registro = montarRegistroExemplo({
      suggestionId: null,
      conversationId: "c1",
      alunoId: null,
      unidade: "",
      mensagens,
      sugestaoOriginal: "",
      respostaFinal: "Vou verificar e te retorno hoje.",
      userId: "u1",
      userNome: "Sérgio",
    });
    expect(registro.suggestion_id).toBeNull();
    expect(registro.aluno_id).toBeNull();
    expect(registro.sugestao_original).toBe("");
    expect(registro.resposta_final).toBe("Vou verificar e te retorno hoje.");
  });

  it("o exemplo salvo é elegível para seleção futura na mesma situação", () => {
    const registro = montarRegistroExemplo({
      suggestionId: "s1",
      conversationId: "c1",
      alunoId: "10",
      unidade: "CEC",
      mensagens,
      sugestaoOriginal: "Texto da IA.",
      respostaFinal: "Consigo dividir em duas vezes.",
      userId: "u1",
      userNome: "Sérgio",
    });
    const salvo = exemplo({
      id: "novo",
      situacao: registro.situacao,
      contexto: registro.contexto,
      sugestao_original: registro.sugestao_original,
      resposta_final: registro.resposta_final,
    });
    expect(selecionarExemplos([salvo], { mensagens, max: 1 })).toEqual([salvo]);
  });
});
