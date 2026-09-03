import { describe, expect, it } from "vitest";
import {
  chaveLembrete,
  contarPorTemplate,
  ehSextaFeira,
  filtrarJaLembrados,
  renderRematriculaMessage,
  selecionarLembretesRematricula,
  templateRematricula,
} from "./rematricula-lembretes";
import type { LinhaAcompanhamento, StatusAcompanhamento } from "./rematricula-acompanhamento";

function linha(
  alunoId: string,
  status: StatusAcompanhamento,
  unidade = "CEC",
): LinhaAcompanhamento {
  return {
    alunoId,
    nome: `Aluno ${alunoId}`,
    unidade,
    turma: "1º Ano",
    status,
    atualizadoEm: null,
    parcelamento: "",
    cadastroAlterado: false,
    escolha: null,
  };
}

describe("lembretes semanais de rematrícula — seleção por status", () => {
  it("mapeia cada status ao template certo e exclui quem já respondeu", () => {
    expect(templateRematricula("nao_iniciado")).toBe("nao_iniciado");
    expect(templateRematricula("em_andamento")).toBe("em_andamento");
    expect(templateRematricula("aguardando_aprovacao")).toBeNull();
    expect(templateRematricula("rematriculado")).toBeNull();
  });

  it("seleciona só Não iniciado e Em andamento, com o status do momento", () => {
    const linhas = [
      linha("1", "nao_iniciado"),
      linha("2", "em_andamento"),
      linha("3", "aguardando_aprovacao"),
      linha("4", "rematriculado"),
      linha("5", "nao_iniciado", "Núcleo Belvedere"),
    ];
    const sel = selecionarLembretesRematricula(linhas);
    expect(sel.map((s) => [s.alunoId, s.template])).toEqual([
      ["1", "nao_iniciado"],
      ["2", "em_andamento"],
      ["5", "nao_iniciado"],
    ]);
    expect(sel.every((s) => s.status === s.template)).toBe(true);
    expect(sel.find((s) => s.alunoId === "5")?.unidade).toBe("Núcleo Belvedere");
    expect(contarPorTemplate(sel)).toEqual({ nao_iniciado: 2, em_andamento: 1 });
  });

  it("não seleciona ninguém quando todos já responderam", () => {
    expect(
      selecionarLembretesRematricula([
        linha("1", "aguardando_aprovacao"),
        linha("2", "rematriculado"),
      ]),
    ).toEqual([]);
  });

  it("pula o aluno já lembrado na rodada, por unidade + AlunoID", () => {
    const sel = selecionarLembretesRematricula([
      linha("7", "nao_iniciado", "CEC"),
      linha("7", "nao_iniciado", "CEC Baby"),
      linha("8", "em_andamento", "CEC"),
    ]);
    const { pendentes, pulados } = filtrarJaLembrados(sel, new Set([chaveLembrete("CEC", "7")]));
    expect(pulados).toBe(1);
    expect(pendentes.map((p) => `${p.unidade}/${p.alunoId}`)).toEqual(["CEC Baby/7", "CEC/8"]);
  });
});

describe("lembretes semanais de rematrícula — agenda e mensagem", () => {
  it("reconhece sexta-feira", () => {
    expect(ehSextaFeira("2026-09-04")).toBe(true);
    expect(ehSextaFeira("2026-09-03")).toBe(false);
    expect(ehSextaFeira("")).toBe(false);
  });

  it("renderiza o texto de cada template com as variáveis", () => {
    const vars = {
      to: "31999990000",
      responsavel: "Maria",
      aluno: "João",
      unidade: "CEC",
      anoLetivo: "2027",
      link: "https://schoolhubbr.vercel.app/rematricula",
    };
    expect(renderRematriculaMessage("nao_iniciado", vars)).toContain("ainda não foi iniciada");
    expect(renderRematriculaMessage("em_andamento", vars)).toContain("ainda não foi concluída");
    expect(renderRematriculaMessage("nao_iniciado", vars)).toContain("Olá Maria");
    expect(renderRematriculaMessage("em_andamento", vars)).toContain(vars.link);
  });
});
