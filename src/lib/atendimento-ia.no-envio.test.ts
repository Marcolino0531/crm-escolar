// Trava estrutural: gerar sugestão NUNCA pode enviar mensagem.
//
// A garantia não é testável por chamada (a server function precisa de Supabase,
// Sponte e Anthropic reais), então é verificada no próprio código: o módulo de
// sugestões não importa nem menciona nenhum caminho de envio de WhatsApp, e a
// leitura do Sponte usa apenas os coletores de consulta.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "..", "..", "src", "lib");
// Comentários fora: o cabeçalho do módulo cita o caminho de envio justamente
// para dizer que não é usado aqui.
function semComentarios(fonte: string): string {
  return fonte
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("//"))
    .join("\n");
}

const sugestoes = semComentarios(readFileSync(join(DIR, "atendimento-ia.functions.ts"), "utf8"));
const cliente = readFileSync(join(DIR, "anthropic.server.ts"), "utf8");

describe("gerar sugestão não envia mensagem", () => {
  it("não importa nenhuma função de envio do Atendimento", () => {
    for (const envio of ["enviarMensagemChat", "enviarMidiaChat", "enviarTemplate"]) {
      expect(sugestoes).not.toContain(envio);
    }
  });

  it("não fala com a Cloud API da Meta", () => {
    for (const alvo of ["graph.facebook.com", "WHATSAPP_TOKEN", "PHONE_NUMBER_ID", "/messages"]) {
      expect(sugestoes).not.toContain(alvo);
    }
  });

  it("apenas lê o histórico: nada é gravado em whatsapp_messages", () => {
    const trechos = sugestoes.split("whatsapp_messages").slice(1);
    expect(trechos.length).toBeGreaterThan(0);
    // Depois da tabela do histórico só aparece leitura (select), nunca escrita.
    for (const trecho of trechos) {
      const proximaChamada = trecho.slice(0, 200);
      expect(proximaChamada).toContain(".select(");
      for (const escrita of [".insert(", ".update(", ".upsert(", ".delete("]) {
        expect(proximaChamada).not.toContain(escrita);
      }
    }
  });

  it("usa somente consultas de leitura do Sponte", () => {
    expect(sugestoes).toContain("coletarDividaAbertaAluno");
    expect(sugestoes).toContain("buscarResponsavelFinanceiroAluno");
    // Escritas no ERP (faturamento da Colônia, baixas) não têm lugar aqui.
    for (const escrita of ["IncluirContaReceber", "faturar", "BaixarParcela"]) {
      expect(sugestoes).not.toContain(escrita);
    }
  });

  it("só toca em tabelas do próprio assistente e na leitura da conversa", () => {
    const permitidas = [
      "ai_suggestions",
      "ai_atendimento_settings",
      "whatsapp_conversations",
      "whatsapp_messages",
      "whatsapp_billing_exceptions",
    ];
    const tabelas = [...sugestoes.matchAll(/\.from\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(tabelas).toContain("ai_suggestions");
    for (const tabela of tabelas) expect(permitidas).toContain(tabela);
  });
});

describe("cliente da Anthropic", () => {
  it("lê a chave só do ambiente do servidor e nunca a registra em log", () => {
    expect(cliente).toContain("process.env.ANTHROPIC_API_KEY");
    const logs = [...cliente.matchAll(/console\.[a-z]+\([^)]*\)/g)].map((m) => m[0]);
    for (const log of logs) {
      expect(log).not.toContain("apiKey");
      expect(log).not.toContain("ANTHROPIC_API_KEY");
    }
  });

  it("chama o endpoint oficial de mensagens da Anthropic", () => {
    expect(cliente).toContain("https://api.anthropic.com/v1/messages");
    expect(cliente).toContain("anthropic-version");
  });
});
