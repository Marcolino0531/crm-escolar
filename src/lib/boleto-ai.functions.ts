import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  pdfText: z.string().min(10).max(200000),
  expectedTotal: z.number().positive(),
  knownSubcategories: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        categoryId: z.string(),
        categoryName: z.string(),
      }),
    )
    .max(500),
});

export type ExtractedItem = {
  subcategory_label: string;
  amount: number;
  matched_subcategory_id: string | null;
  matched_category_id: string | null;
};

export const extractBoletoBreakdown = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada");

    const subList = data.knownSubcategories
      .map((s) => `- "${s.name}" (categoria: "${s.categoryName}", id: ${s.id})`)
      .join("\n");

    const systemPrompt = `Você é um assistente que extrai composição financeira de relatórios de boletos bancários em PDF.

Sua tarefa: ler o texto extraído de um PDF de repasse/recebimento de boletos e retornar o desmembramento por subcategoria de receita, somando os valores quando a mesma subcategoria aparecer várias vezes.

Subcategorias conhecidas no sistema (use o id quando reconhecer):
${subList || "(nenhuma cadastrada)"}

Regras estritas:
- Some os valores por subcategoria. Ex: várias linhas de "Mensalidade" devem virar UMA entrada somada.
- subcategory_label = nome como aparece no PDF.
- Se reconhecer a subcategoria entre as conhecidas (mesmo com variações de grafia), preencha matched_subcategory_id e matched_category_id. Caso contrário use null.
- amounts em número decimal (ex: 1234.56).
- A SOMA de todos os amounts DEVE ser igual a ${data.expectedTotal.toFixed(2)} (tolerância de R$ 0,02). Se não bater, ajuste/revise.`;

    const userPrompt = `Texto do PDF:\n\n${data.pdfText.slice(0, 80000)}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_breakdown",
              description: "Retorna o desmembramento agrupado por subcategoria.",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        subcategory_label: { type: "string" },
                        amount: { type: "number" },
                        matched_subcategory_id: { type: ["string", "null"] },
                        matched_category_id: { type: ["string", "null"] },
                      },
                      required: [
                        "subcategory_label",
                        "amount",
                        "matched_subcategory_id",
                        "matched_category_id",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["items"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_breakdown" } },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 429) throw new Error("Limite de requisições à IA excedido. Tente em instantes.");
      if (resp.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos em Workspace > Usage.");
      throw new Error(`Erro do gateway de IA (${resp.status}): ${text.slice(0, 200)}`);
    }

    const payload = await resp.json();
    const call = payload?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) throw new Error("IA não retornou um desmembramento.");
    let parsed: { items: ExtractedItem[] };
    try {
      parsed = JSON.parse(call.function.arguments);
    } catch {
      throw new Error("Resposta da IA inválida.");
    }

    const items = (parsed.items ?? []).filter((it) => it && typeof it.amount === "number");
    const sum = items.reduce((s, i) => s + Number(i.amount), 0);
    const matches = Math.abs(sum - data.expectedTotal) < 0.02;

    return {
      items,
      sum: Number(sum.toFixed(2)),
      expected: data.expectedTotal,
      matches,
    };
  });
