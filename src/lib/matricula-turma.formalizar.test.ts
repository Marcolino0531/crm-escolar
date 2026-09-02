import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TarefaOnboardingId } from "@/lib/crm/types";
import type { ResultadoMatriculaTurma } from "@/lib/matricula-turma.sponte";

interface OnboardingGravado {
  submission_id: string;
  nome_aluno: string;
  turma: string;
  tarefas: Record<TarefaOnboardingId, boolean>;
  concluido: boolean;
}

const estado: {
  turma: ResultadoMatriculaTurma;
  resendAceita: boolean;
  emails: { to: string[]; subject: string; html: string }[];
  gravados: OnboardingGravado[];
} = {
  turma: {
    status: "matriculado",
    cursoId: 10,
    turmaId: 123,
    turmaNome: "07 - 1º Ano T / A",
    contratoId: 4321,
    jaExistia: false,
    erro: null,
    retorno: "01 - Operação Realizada com Sucesso.",
  },
  resendAceita: true,
  emails: [],
  gravados: [],
};

vi.mock("@/lib/matricula-turma.sponte", () => ({
  matricularEmTurma: async () => estado.turma,
}));

vi.mock("@/lib/agenda.email", () => ({
  getResendConfig: () => ({ apiKey: "k", from: "escola@exemplo.com" }),
  sendEmail: async (_cfg: unknown, input: { to: string[]; subject: string; html: string }) => {
    if (!estado.resendAceita) throw new Error("Resend recusou o destinatário");
    estado.emails.push(input);
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (tabela: string) => {
      if (tabela === "schools") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: "escola-1" } }) }),
          }),
        };
      }
      return {
        upsert: (linha: OnboardingGravado) => {
          estado.gravados.push(linha);
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { id: "onboarding-1" }, error: null }),
            }),
          };
        },
      };
    },
  },
}));

const { formalizarMatriculaTurma } = await import("@/lib/matricula-turma.formalizar");

const ENTRADA = {
  submissionId: "site-1",
  unidade: "Colégio Espaço Cultural",
  alunoId: 700,
  alunoNome: "Aluna de Teste",
  serie: "1º Ano",
  turno: "T" as const,
  anoLetivo: 2026,
  dataMatricula: "2026-09-02",
  responsavel: [
    { nome: "Mãe de Teste", telefone: "31999990000", email: "mae@exemplo.com" },
    { nome: "Pai de Teste", telefone: "31999991111", email: "pai@exemplo.com" },
  ],
};

beforeEach(() => {
  estado.turma = {
    status: "matriculado",
    cursoId: 10,
    turmaId: 123,
    turmaNome: "07 - 1º Ano T / A",
    contratoId: 4321,
    jaExistia: false,
    erro: null,
    retorno: "01 - Operação Realizada com Sucesso.",
  };
  estado.resendAceita = true;
  estado.emails = [];
  estado.gravados = [];
});

describe("formalização da matrícula", () => {
  it("cria o onboarding com nome e turma e marca as boas-vindas enviadas", async () => {
    const r = await formalizarMatriculaTurma(ENTRADA);

    expect(r.onboardingId).toBe("onboarding-1");
    expect(r.boasVindas).toBe("enviado");
    expect(estado.emails).toHaveLength(1);
    expect(estado.emails[0].to).toEqual(["mae@exemplo.com"]);
    expect(estado.emails[0].html).toContain("07 - 1º Ano T / A");
    expect(estado.emails[0].html).toContain("Colégio Espaço Cultural");

    const gravado = estado.gravados[0];
    expect(gravado.submission_id).toBe("site-1");
    expect(gravado.nome_aluno).toBe("Aluna de Teste");
    expect(gravado.turma).toBe("07 - 1º Ano T / A");
    expect(gravado.tarefas["boas-vindas"]).toBe(true);
    expect(gravado.tarefas["conferencia-turma"]).toBe(false);
    expect(gravado.concluido).toBe(false);
  });

  it("mantém as boas-vindas pendentes quando o Resend recusa o email", async () => {
    estado.resendAceita = false;

    const r = await formalizarMatriculaTurma(ENTRADA);

    expect(r.boasVindas).toBe("falhou");
    expect(r.onboardingId).toBe("onboarding-1");
    expect(estado.gravados[0].tarefas["boas-vindas"]).toBe(false);
  });

  it("registra sem_email quando nenhum responsável tem email", async () => {
    const r = await formalizarMatriculaTurma({
      ...ENTRADA,
      responsavel: [{ nome: "Mãe", telefone: "31999990000", email: "" }],
    });

    expect(r.boasVindas).toBe("sem_email");
    expect(estado.emails).toHaveLength(0);
    expect(estado.gravados[0].tarefas["boas-vindas"]).toBe(false);
  });

  it("não cria onboarding nem envia email sem matrícula formal na turma", async () => {
    estado.turma = {
      status: "sem_turma",
      cursoId: 10,
      turmaId: null,
      turmaNome: null,
      contratoId: null,
      jaExistia: false,
      erro: "Nenhuma turma aberta",
      retorno: null,
    };

    const r = await formalizarMatriculaTurma(ENTRADA);

    expect(r.onboardingId).toBeNull();
    expect(r.boasVindas).toBeNull();
    expect(estado.gravados).toHaveLength(0);
    expect(estado.emails).toHaveLength(0);
  });
});
