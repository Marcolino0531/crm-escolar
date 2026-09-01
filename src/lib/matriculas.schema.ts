// Contrato do payload de matrícula (Google Forms → School Hub → Sponte).
//
// Fica isolado do handler HTTP porque o reprocessamento do Dashboard de
// Matrículas revalida o payload gravado na auditoria antes de reenviá-lo — o
// formato aceito na tela é exatamente o mesmo aceito no webhook.

import { z } from "zod";
import { UNIDADES_SPONTE } from "@/lib/sponte.functions";

const texto = z.string().trim();
const opcional = texto.optional().default("");

const EnderecoSchema = z.object({
  cep: texto.min(1, "CEP é obrigatório"),
  numero: texto.min(1, "Número é obrigatório"),
  complemento: opcional,
  logradouro: opcional,
  bairro: opcional,
  cidade: opcional,
});

export const MatriculaSchema = z.object({
  submissionId: texto.optional(),
  unidade: texto.refine((u) => UNIDADES_SPONTE.includes(u), {
    message: `Unidade inválida. Use uma destas: ${UNIDADES_SPONTE.join(", ")}`,
  }),
  // Reprocessa só os responsáveis de um aluno que já entrou no Sponte.
  alunoIdExistente: z.number().int().positive().optional(),
  aluno: z.object({
    nome: texto.min(3, "Nome completo do aluno é obrigatório"),
    dataNascimento: texto.min(1, "Data de nascimento do aluno é obrigatória"),
    cpf: opcional,
    rg: opcional,
    sexo: opcional,
    naturalidade: opcional,
    nacionalidade: opcional,
    estadoCivil: opcional,
    email: opcional,
    telefone: opcional,
    celular: opcional,
    observacao: opcional,
    situacao: opcional,
    midia: opcional,
  }),
  endereco: EnderecoSchema,
  responsaveis: z
    .array(
      z.object({
        nome: texto.min(3, "Nome do responsável é obrigatório"),
        parentesco: texto.min(1, "Parentesco é obrigatório"),
        parentescoId: z.number().int().optional(),
        dataNascimento: opcional,
        // O Sponte recusa responsável sem CPF ("27 - Campo CPF é obrigatório"),
        // então barramos aqui — antes de o aluno ser criado.
        cpf: texto.refine((c) => c.replace(/\D/g, "").length === 11, {
          message: "CPF do responsável é obrigatório (o Sponte recusa o cadastro sem ele)",
        }),
        rg: opcional,
        sexo: opcional,
        profissao: opcional,
        email: opcional,
        telefone: opcional,
        celular: opcional,
        responsavelFinanceiro: z.boolean().default(false),
        responsavelDidatico: z.boolean().default(false),
        endereco: EnderecoSchema.optional(),
      }),
    )
    .min(1, "Envie ao menos um responsável"),
});

// "aluno.nome: Nome completo do aluno é obrigatório" — mensagens prontas para
// devolver ao formulário (webhook) ou exibir na tela (reprocessamento).
export function problemasDoPayload(erro: z.ZodError): string[] {
  return erro.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}
