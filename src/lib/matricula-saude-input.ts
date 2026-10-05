// Entrada do Questionário de Saúde validada no servidor: a mesma para o
// formulário de matrícula e para a rematrícula.

import { z } from "zod";

const RespostaSaudeInput = z.object({
  opcao: z.enum(["Sim", "Não", ""]),
  detalhe: z.string(),
});

const ContatoEmergenciaInput = z.object({
  nome: z.string().max(120),
  telefone: z.string().max(20),
  parentesco: z.string().max(60),
});

const PessoaAutorizadaInput = ContatoEmergenciaInput.extend({ cpf: z.string().max(14) });

export const SaudeInput = z.object({
  contatosEmergencia: z.array(ContatoEmergenciaInput).max(10),
  alergia: RespostaSaudeInput,
  problemaSaude: RespostaSaudeInput,
  medicamentoContinuo: RespostaSaudeInput,
  planoSaude: RespostaSaudeInput,
  pessoasAutorizadas: z.array(PessoaAutorizadaInput).max(10),
  corRaca: z.string(),
  outrasInformacoes: z.string(),
});
