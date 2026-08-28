import { describe, expect, it } from "vitest";
import {
  DESAFIO_VAZIO,
  MAX_TENTATIVAS_CODIGO,
  MENSAGEM_BLOQUEADO,
  MENSAGEM_CODIGO_EXPIRADO,
  MENSAGEM_CODIGO_INCORRETO,
  chaveSerie,
  codigoFormatoValido,
  expiracaoCodigo,
  gerarCodigoVerificacao,
  opcoesParcelamentoMaterial,
  parcelamentoMaterial,
  rotuloParcelamento,
  serieDaTurma,
  validarCodigo,
  type DesafioCodigo,
} from "@/lib/rematricula";

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
