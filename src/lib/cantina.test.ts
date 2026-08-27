import { describe, expect, it } from "vitest";
import {
  BLOQUEIO_MINUTOS,
  MAX_TENTATIVAS_LOGIN,
  TENTATIVAS_ZERADAS,
  estaBloqueado,
  indicacaoLancamentoManual,
  linkWhatsAppColegio,
  mensagemWhatsAppRecarga,
  minutosRestantesBloqueio,
  normalizarCpf,
  parcelasEmAberto,
  proximaParcelaEmAberto,
  registrarFalha,
  registrarSucesso,
  transicaoRecarga,
  valorRecargaValido,
  type ParcelaAberta,
  type TentativasLogin,
} from "./cantina";

const T0 = "2026-08-18T12:00:00.000Z";

function maisTarde(minutos: number, base = T0): string {
  return new Date(Date.parse(base) + minutos * 60000).toISOString();
}

// Aplica N falhas consecutivas a partir do estado zerado, todas no mesmo
// instante (o caso do ataque: tentativas em rajada).
function falharVezes(n: number, agoraISO = T0): TentativasLogin {
  let estado = TENTATIVAS_ZERADAS;
  for (let i = 0; i < n; i++) estado = registrarFalha(estado, agoraISO);
  return estado;
}

describe("bloqueio temporário do login do portal da cantina", () => {
  it("não bloqueia nas quatro primeiras falhas", () => {
    for (let n = 1; n < MAX_TENTATIVAS_LOGIN; n++) {
      const estado = falharVezes(n);
      expect(estado.falhas).toBe(n);
      expect(estado.bloqueadoAte).toBeNull();
      expect(estaBloqueado(estado, T0)).toBe(false);
    }
  });

  it("bloqueia exatamente na quinta falha consecutiva", () => {
    const estado = falharVezes(MAX_TENTATIVAS_LOGIN);
    expect(estado.bloqueadoAte).not.toBeNull();
    expect(estaBloqueado(estado, T0)).toBe(true);
  });

  it("bloqueia por 15 minutos", () => {
    const estado = falharVezes(MAX_TENTATIVAS_LOGIN);
    expect(estado.bloqueadoAte).toBe(maisTarde(BLOQUEIO_MINUTOS));
    expect(minutosRestantesBloqueio(estado, T0)).toBe(BLOQUEIO_MINUTOS);
  });

  it("rejeita tentativas durante toda a janela, inclusive a correta", () => {
    const estado = falharVezes(MAX_TENTATIVAS_LOGIN);
    expect(estaBloqueado(estado, maisTarde(1))).toBe(true);
    expect(estaBloqueado(estado, maisTarde(14))).toBe(true);
    expect(minutosRestantesBloqueio(estado, maisTarde(14))).toBe(1);
  });

  it("não estende o bloqueio a cada nova tentativa dentro da janela", () => {
    const bloqueado = falharVezes(MAX_TENTATIVAS_LOGIN);
    const depois = registrarFalha(bloqueado, maisTarde(5));
    expect(depois.bloqueadoAte).toBe(bloqueado.bloqueadoAte);
  });

  it("libera o login quando a janela expira", () => {
    const estado = falharVezes(MAX_TENTATIVAS_LOGIN);
    expect(estaBloqueado(estado, maisTarde(BLOQUEIO_MINUTOS))).toBe(false);
    expect(estaBloqueado(estado, maisTarde(BLOQUEIO_MINUTOS + 1))).toBe(false);
    expect(minutosRestantesBloqueio(estado, maisTarde(BLOQUEIO_MINUTOS + 1))).toBe(0);
  });

  it("dá as cinco tentativas cheias de novo depois do bloqueio expirar", () => {
    const expirado = falharVezes(MAX_TENTATIVAS_LOGIN);
    const t1 = maisTarde(BLOQUEIO_MINUTOS + 1);

    let estado = expirado;
    for (let n = 1; n < MAX_TENTATIVAS_LOGIN; n++) {
      estado = registrarFalha(estado, t1);
      expect(estaBloqueado(estado, t1)).toBe(false);
    }
    estado = registrarFalha(estado, t1);
    expect(estaBloqueado(estado, t1)).toBe(true);
  });

  it("acerto zera a sequência de falhas", () => {
    const quaseBloqueado = falharVezes(MAX_TENTATIVAS_LOGIN - 1);
    expect(quaseBloqueado.falhas).toBe(4);

    const aposSucesso = registrarSucesso();
    expect(aposSucesso).toEqual(TENTATIVAS_ZERADAS);

    // Depois do acerto, quatro novas falhas continuam sem bloquear.
    const estado = (() => {
      let e = aposSucesso;
      for (let i = 0; i < MAX_TENTATIVAS_LOGIN - 1; i++) e = registrarFalha(e, T0);
      return e;
    })();
    expect(estaBloqueado(estado, T0)).toBe(false);
  });

  it("conta por CPF normalizado: máscara diferente é o mesmo contador", () => {
    expect(normalizarCpf("123.456.789-01")).toBe("12345678901");
    expect(normalizarCpf(" 123 456 789 01 ")).toBe("12345678901");
    expect(normalizarCpf("123.456.789-01")).toBe(normalizarCpf("12345678901"));
  });

  it("isola o bloqueio por CPF: um CPF bloqueado não afeta outro", () => {
    const porCpf = new Map<string, TentativasLogin>();
    const alvo = normalizarCpf("123.456.789-01");
    const outro = normalizarCpf("987.654.321-00");

    porCpf.set(alvo, falharVezes(MAX_TENTATIVAS_LOGIN));
    porCpf.set(outro, falharVezes(2));

    expect(estaBloqueado(porCpf.get(alvo) as TentativasLogin, T0)).toBe(true);
    expect(estaBloqueado(porCpf.get(outro) as TentativasLogin, T0)).toBe(false);
  });
});

describe("próximo boleto em aberto para lançar a recarga", () => {
  const hoje = "2026-08-18";

  const parcela = (p: Partial<ParcelaAberta>): ParcelaAberta => ({
    contaReceberID: "1",
    numeroBoleto: "1",
    numeroParcela: "1",
    vencimento: "2026-09-10",
    categoria: "Mensalidade",
    saldo: 1200,
    quitada: false,
    ...p,
  });

  it("ignora parcelas quitadas e sem saldo", () => {
    const abertas = parcelasEmAberto([
      parcela({ contaReceberID: "a", quitada: true }),
      parcela({ contaReceberID: "b", saldo: 0 }),
      parcela({ contaReceberID: "c" }),
    ]);
    expect(abertas.map((p) => p.contaReceberID)).toEqual(["c"]);
  });

  it("escolhe a parcela em aberto de vencimento mais próximo no futuro", () => {
    const alvo = proximaParcelaEmAberto(
      [
        parcela({ contaReceberID: "out", vencimento: "2026-10-10" }),
        parcela({ contaReceberID: "set", vencimento: "2026-09-10" }),
        parcela({ contaReceberID: "nov", vencimento: "2026-11-10" }),
      ],
      hoje,
    );
    expect(alvo?.contaReceberID).toBe("set");
  });

  it("preserva a data de vencimento normal do boleto escolhido", () => {
    const alvo = proximaParcelaEmAberto(
      [parcela({ contaReceberID: "set", vencimento: "2026-09-10" })],
      hoje,
    );
    expect(alvo?.vencimento).toBe("2026-09-10");
  });

  it("aceita boleto que vence hoje", () => {
    const alvo = proximaParcelaEmAberto([parcela({ vencimento: hoje })], hoje);
    expect(alvo?.vencimento).toBe(hoje);
  });

  it("ignora parcelas já vencidas (não lança em boleto atrasado)", () => {
    const alvo = proximaParcelaEmAberto(
      [
        parcela({ contaReceberID: "jul", vencimento: "2026-07-10" }),
        parcela({ contaReceberID: "ago", vencimento: "2026-08-10" }),
      ],
      hoje,
    );
    expect(alvo).toBeNull();
  });

  it("não devolve boleto quando o aluno só tem parcelas quitadas", () => {
    const alvo = proximaParcelaEmAberto(
      [parcela({ vencimento: "2026-09-10", quitada: true, saldo: 0 })],
      hoje,
    );
    expect(alvo).toBeNull();
  });

  it("prefere a mensalidade quando há mais de uma cobrança no mesmo vencimento", () => {
    const alvo = proximaParcelaEmAberto(
      [
        parcela({ contaReceberID: "esportes", categoria: "Esportes", vencimento: "2026-09-10" }),
        parcela({ contaReceberID: "mensal", categoria: "Mensalidade", vencimento: "2026-09-10" }),
      ],
      hoje,
    );
    expect(alvo?.contaReceberID).toBe("mensal");
  });

  it("usa a parcela não-mensalidade quando ela vence antes", () => {
    const alvo = proximaParcelaEmAberto(
      [
        parcela({ contaReceberID: "material", categoria: "Material", vencimento: "2026-08-25" }),
        parcela({ contaReceberID: "mensal", categoria: "Mensalidade", vencimento: "2026-09-10" }),
      ],
      hoje,
    );
    expect(alvo?.contaReceberID).toBe("material");
  });
});

describe("valor e mensagem da solicitação", () => {
  it("recusa valor zerado, negativo ou absurdo", () => {
    expect(valorRecargaValido(0)).toBe(false);
    expect(valorRecargaValido(-50)).toBe(false);
    expect(valorRecargaValido(Number.NaN)).toBe(false);
    expect(valorRecargaValido(5000)).toBe(false);
  });

  it("aceita valor positivo dentro do limite", () => {
    expect(valorRecargaValido(1)).toBe(true);
    expect(valorRecargaValido(150.5)).toBe(true);
  });

  it("monta a mensagem de WhatsApp com aluno e valor", () => {
    const texto = mensagemWhatsAppRecarga("Maria Silva", 150);
    expect(texto).toContain("Maria Silva");
    expect(texto).toContain("150,00");
  });

  it("monta o link do WhatsApp do colégio com DDI 55", () => {
    expect(linkWhatsAppColegio("(31) 99999-8888", "oi")).toBe(
      "https://wa.me/5531999998888?text=oi",
    );
    expect(linkWhatsAppColegio("5531999998888", "oi")).toBe("https://wa.me/5531999998888?text=oi");
  });

  it("não gera link sem telefone cadastrado", () => {
    expect(linkWhatsAppColegio("", "oi")).toBeNull();
    expect(linkWhatsAppColegio("3199", "oi")).toBeNull();
  });
});

describe("cantina — transições da solicitação", () => {
  it("efetiva a recarga só a partir de pendente", () => {
    expect(transicaoRecarga("pendente", "efetivar")).toEqual({
      ok: true,
      proximoStatus: "efetivada",
    });
  });

  it("recusa efetivar duas vezes (clique duplo não duplica histórico)", () => {
    const r = transicaoRecarga("efetivada", "efetivar");
    expect(r.ok).toBe(false);
    expect(r.proximoStatus).toBeUndefined();
    expect(transicaoRecarga("lancada_no_boleto", "efetivar").ok).toBe(false);
  });

  it("marca lançada no boleto só depois da recarga efetivada", () => {
    expect(transicaoRecarga("efetivada", "marcar_lancada")).toEqual({
      ok: true,
      proximoStatus: "lancada_no_boleto",
    });
    expect(transicaoRecarga("pendente", "marcar_lancada").ok).toBe(false);
    expect(transicaoRecarga("lancada_no_boleto", "marcar_lancada").ok).toBe(false);
  });

  it("indica manualmente o boleto alvo do valor da recarga", () => {
    const texto = indicacaoLancamentoManual(50, {
      numeroBoleto: "12345",
      vencimento: "2026-09-10",
    }).replace(/\u00a0/g, " ");
    expect(texto).toBe("Incluir R$ 50,00 no boleto 12345 (vencimento 10/09/2026).");
  });

  it("sem parcela em aberto, orienta o próximo boleto a ser emitido", () => {
    const texto = indicacaoLancamentoManual(50, null).replace(/\u00a0/g, " ");
    expect(texto).toContain("R$ 50,00");
    expect(texto).toContain("próximo boleto");
  });
});
