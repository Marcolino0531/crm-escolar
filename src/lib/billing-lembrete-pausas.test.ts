import { describe, expect, it } from "vitest";
import { filtrarPausadosLembrete } from "./billing-lembrete-pausas";

describe("pausa manual dos lembretes preventivos", () => {
  const parcelas = [
    { alunoId: "1", telefone: "(31) 99205-3500" },
    { alunoId: "2", telefone: "5531988596979" },
    { alunoId: "3", telefone: "(31) 91111-2222" },
  ];

  it("remove o número pausado independentemente da formatação/DDI", () => {
    const r = filtrarPausadosLembrete(parcelas, [
      { telefone: "31992053500" },
      { telefone: "(31) 98859-6979" },
    ]);
    expect(r.map((p) => p.alunoId)).toEqual(["3"]);
  });

  it("sem pausa, nada muda", () => {
    expect(filtrarPausadosLembrete(parcelas, [])).toEqual(parcelas);
  });

  it("pausa com telefone vazio não pausa ninguém", () => {
    expect(filtrarPausadosLembrete(parcelas, [{ telefone: "" }])).toHaveLength(3);
  });
});
