import { describe, expect, it } from "vitest";
import {
  contadoresAcompanhamento,
  filtrarAcompanhamento,
  filtrarPorStatus,
  montarLinhasAcompanhamento,
  ordenarAcompanhamento,
  resumirLancamentosRevisao,
  type AcessoAcompanhamento,
  type AlunoAtivoAcompanhamento,
  type EnvioAcompanhamento,
  type EscolhaAcompanhamento,
} from "./rematricula-acompanhamento";

const alunos: AlunoAtivoAcompanhamento[] = [
  { alunoId: "1", nome: "Ana", unidade: "CEC", turma: "1º Ano" },
  { alunoId: "2", nome: "Bruno", unidade: "CEC", turma: "1º Ano" },
  { alunoId: "3", nome: "Carla", unidade: "CEC", turma: "2º Ano" },
  { alunoId: "4", nome: "Davi", unidade: "CEC", turma: "2º Ano" },
  // Mesmo AlunoID de outra unidade: o cruzamento é por (unidade, alunoId).
  { alunoId: "1", nome: "Elisa", unidade: "Núcleo Belvedere", turma: "3º Ano" },
];

const escolha = (
  unidade: string,
  alunoId: string,
  status: EscolhaAcompanhamento["status"],
): EscolhaAcompanhamento => ({
  id: `escolha-${unidade}-${alunoId}`,
  unidade,
  alunoId,
  serie: "1º Ano",
  valorAnual: 1000,
  parcelas: 3,
  valorParcela: 333.33,
  valorPrimeiraParcela: 333.34,
  anoLetivo: 2027,
  status,
  atualizadoEm: "2026-08-20T12:00:00.000Z",
  sponteContaReceberId: status === "lancada" ? "12900" : "",
  sponteErro: "",
});

const escolhas: EscolhaAcompanhamento[] = [
  escolha("CEC", "3", "pendente_lancamento"),
  escolha("CEC", "4", "lancada"),
  escolha("Núcleo Belvedere", "1", "pendente_lancamento"),
];

const acessos: AcessoAcompanhamento[] = [
  { unidade: "CEC", alunoId: "2", ultimoAcessoEm: "2026-08-21T09:00:00.000Z" },
];

// Carla e Davi clicaram em Finalizar Matrícula; Elisa só confirmou o material.
const envios: EnvioAcompanhamento[] = [
  { unidade: "CEC", alunoId: "3", enviadaEm: "2026-08-20T11:00:00.000Z" },
  { unidade: "CEC", alunoId: "4", enviadaEm: "2026-08-20T11:00:00.000Z" },
];

const linhas = montarLinhasAcompanhamento({
  alunos,
  escolhas,
  acessos,
  envios,
  cadastroAlterados: [{ unidade: "CEC", alunoId: "3" }],
});

describe("linhas de acompanhamento da rematrícula", () => {
  it("gera uma linha por aluno ativo, com o status derivado do que foi persistido", () => {
    expect(linhas).toHaveLength(alunos.length);
    const porNome = new Map(linhas.map((l) => [l.nome, l]));
    expect(porNome.get("Ana")!.status).toBe("nao_iniciado");
    expect(porNome.get("Bruno")!.status).toBe("em_andamento");
    expect(porNome.get("Carla")!.status).toBe("aguardando_aprovacao");
    expect(porNome.get("Davi")!.status).toBe("rematriculado");
    // Escolha de parcelamento salva sem o envio final é só progresso parcial.
    expect(porNome.get("Elisa")!.status).toBe("em_andamento");
  });

  it("confirmar o material não conta como respondido; só o Finalizar Matrícula conta", () => {
    const antes = contadoresAcompanhamento(linhas);
    expect(antes.responderam).toBe(2);
    const depois = montarLinhasAcompanhamento({
      alunos,
      escolhas,
      acessos,
      envios: [
        ...envios,
        { unidade: "Núcleo Belvedere", alunoId: "1", enviadaEm: "2026-08-22T10:00:00.000Z" },
      ],
      cadastroAlterados: [],
    });
    expect(depois.find((l) => l.nome === "Elisa")!.status).toBe("aguardando_aprovacao");
    expect(contadoresAcompanhamento(depois).responderam).toBe(3);
  });

  it("mostra o parcelamento escolhido e o indicador de dado cadastral alterado", () => {
    const carla = linhas.find((l) => l.nome === "Carla")!;
    // O Intl usa espaço não-quebrável depois de "R$".
    expect(carla.parcelamento.replace(/\u00a0/g, " ")).toBe("3x de R$ 333,33 (1ª de R$ 333,34)");
    expect(carla.cadastroAlterado).toBe(true);
    expect(carla.atualizadoEm).toBe("2026-08-20T12:00:00.000Z");
    const ana = linhas.find((l) => l.nome === "Ana")!;
    expect(ana.parcelamento).toBe("");
    expect(ana.cadastroAlterado).toBe(false);
    expect(ana.atualizadoEm).toBeNull();
  });

  it("ordena pendências primeiro e rematriculado por último", () => {
    expect(ordenarAcompanhamento(linhas).map((l) => l.status)).toEqual([
      "nao_iniciado",
      "em_andamento",
      "em_andamento",
      "aguardando_aprovacao",
      "rematriculado",
    ]);
  });

  it("filtra por unidade e por nome", () => {
    expect(filtrarAcompanhamento(linhas, { unidade: "CEC" })).toHaveLength(4);
    expect(
      filtrarAcompanhamento(linhas, {
        unidadesPermitidas: ["CEC", "Núcleo Belvedere"],
      }),
    ).toHaveLength(5);
    expect(filtrarAcompanhamento(linhas, { unidadesPermitidas: ["CEC"] })).toHaveLength(4);
    expect(
      filtrarAcompanhamento(linhas, { unidade: null, busca: " car " }).map((l) => l.nome),
    ).toEqual(["Carla"]);
  });
});

describe("cards de resumo x tabela filtrada por status", () => {
  it("bate com a contagem real da tabela em cada filtro de status", () => {
    for (const filtro of [
      { unidade: null as string | null, unidadesPermitidas: ["CEC", "Núcleo Belvedere"] },
      { unidade: "CEC" as string | null, unidadesPermitidas: ["CEC", "Núcleo Belvedere"] },
      {
        unidade: "Núcleo Belvedere" as string | null,
        unidadesPermitidas: ["CEC", "Núcleo Belvedere"],
      },
    ]) {
      const base = filtrarAcompanhamento(linhas, filtro);
      const cards = contadoresAcompanhamento(base);

      expect(cards.total).toBe(filtrarPorStatus(base, "todos").length);
      expect(cards.aguardandoAprovacao).toBe(filtrarPorStatus(base, "aguardando_aprovacao").length);
      expect(cards.responderam).toBe(
        filtrarPorStatus(base, "aguardando_aprovacao").length +
          filtrarPorStatus(base, "rematriculado").length,
      );
      expect(cards.naoResponderam).toBe(
        filtrarPorStatus(base, "nao_iniciado").length +
          filtrarPorStatus(base, "em_andamento").length,
      );
      expect(cards.responderam + cards.naoResponderam).toBe(cards.total);
    }
  });

  it("a busca por nome também reflete nos cards", () => {
    const base = filtrarAcompanhamento(linhas, { unidade: "CEC", busca: "a" });
    const cards = contadoresAcompanhamento(base);
    expect(cards.total).toBe(base.length);
    expect(cards.responderam).toBe(base.filter((l) => l.parcelamento !== "").length);
  });
});

describe("resumirLancamentosRevisao — material e matrícula independentes", () => {
  const ok = (conta: string) => ({ ok: true, lancadaNoSponte: true, sponteContaReceberId: conta });

  it("material lançado e matrícula com falha no Sponte: ambos aparecem, sem fechar", () => {
    const r = resumirLancamentosRevisao({
      material: ok("123"),
      matricula: { ok: true, lancadaNoSponte: false, sponteErro: "InsertPlano recusado" },
    });
    expect(r.mensagens).toEqual([
      { tipo: "sucesso", texto: "Material Pedagógico lançado no Sponte (conta a receber 123)." },
      {
        tipo: "erro",
        texto: "Matrícula aprovado, mas NÃO foi lançado no Sponte: InsertPlano recusado",
      },
    ]);
    expect(r.algumSucesso).toBe(true);
    expect(r.tudoOk).toBe(false);
  });

  it("matrícula lançada e material com erro de rede: o sucesso da matrícula não é escondido", () => {
    const r = resumirLancamentosRevisao({
      material: new Error("Falha de conexão"),
      matricula: ok("456"),
    });
    expect(r.mensagens.map((m) => m.tipo)).toEqual(["erro", "sucesso"]);
    expect(r.mensagens[0].texto).toBe("Material Pedagógico: Falha de conexão");
    expect(r.algumSucesso).toBe(true);
    expect(r.tudoOk).toBe(false);
  });

  it("recusa de negócio (ok:false) vira erro com a mensagem do servidor", () => {
    const r = resumirLancamentosRevisao({
      material: { ok: false, erro: "Esta solicitação já foi lançada no Sponte." },
      matricula: null,
    });
    expect(r.mensagens).toEqual([
      { tipo: "erro", texto: "Material Pedagógico: Esta solicitação já foi lançada no Sponte." },
    ]);
    expect(r.algumSucesso).toBe(false);
  });

  it("os dois lançados: tudoOk e uma mensagem de sucesso para cada", () => {
    const r = resumirLancamentosRevisao({ material: ok("1"), matricula: ok("2") });
    expect(r.tudoOk).toBe(true);
    expect(r.mensagens).toHaveLength(2);
  });

  it("lançado com pendência de ajuste de parcela conta como erro (não fecha o modal)", () => {
    const r = resumirLancamentosRevisao({
      material: null,
      matricula: { ...ok("9"), sponteErro: "parcela 2 não ajustada" },
    });
    expect(r.mensagens[0].tipo).toBe("erro");
    expect(r.mensagens[0].texto).toContain("conta 9");
    expect(r.tudoOk).toBe(false);
  });

  it("nada tentado: sem mensagens e não fecha", () => {
    expect(resumirLancamentosRevisao({ material: null, matricula: null })).toEqual({
      mensagens: [],
      algumSucesso: false,
      tudoOk: false,
    });
  });
});
