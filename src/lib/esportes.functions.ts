// Server functions do módulo "Esportes Extracurriculares".
//
// O painel mensal por modalidade não guarda valor arrecadado: ele consulta o
// Sponte no momento em que a tela é aberta e soma, por aluno matriculado, o que
// foi pago na CATEGORIA da modalidade dentro do boleto de mensalidade. Roda no
// servidor porque as credenciais do Sponte não podem ir ao navegador — e porque
// o parceiro é externo: ele nunca recebe acesso direto à API do Sponte, só o
// resultado agregado da(s) modalidade(s) dele.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { coletarTitulosAluno } from "@/lib/sponte.functions";
import {
  calcularRepasse,
  pagamentoDoAluno,
  totalArrecadado,
  type PagamentoAlunoModalidade,
  type RepasseCalculado,
} from "@/lib/esportes-repasse";

// Consultas ao Sponte em paralelo, no mesmo teto usado pela cobrança automática.
const CONCORRENCIA_SPONTE = 5;

interface ModalidadeRow {
  id: string;
  nome: string;
  categoria_sponte: string;
  parceiro_nome: string;
  percentual_parceiro: number;
  unidade: string;
}

interface MatriculaRow {
  aluno_id: string;
  aluno_nome: string;
  turma: string;
}

export interface ArrecadacaoModalidadeResult extends RepasseCalculado {
  modalidadeId: string;
  mesReferencia: string;
  alunos: PagamentoAlunoModalidade[];
  // Falhas de consulta ao Sponte (por aluno) — o total mostrado fica parcial.
  avisos: string[];
  error?: string;
}

const ArrecadacaoInputSchema = z.object({
  modalidadeId: z.string().uuid(),
  mesReferencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês de referência inválido."),
});

// Autorização por MODALIDADE (não por módulo inteiro): reproduz no servidor a
// regra do banco, para que um parceiro não consiga ler a modalidade de outro
// forjando a requisição.
async function assertPodeVerModalidade(userId: string, modalidadeId: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "can_view_modalidade_esporte" as never,
    { _user_id: userId, _modalidade_id: modalidadeId } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem acesso a esta modalidade.");
}

export const fetchArrecadacaoModalidade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ArrecadacaoInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ArrecadacaoModalidadeResult> => {
    const { modalidadeId, mesReferencia } = data;
    await assertPodeVerModalidade(context.userId, modalidadeId);

    const vazio = {
      modalidadeId,
      mesReferencia,
      alunos: [],
      avisos: [],
      ...calcularRepasse(0, 0),
    };

    const { data: modRow, error: modErr } = await supabaseAdmin
      .from("esportes_modalidades" as never)
      .select("id, nome, categoria_sponte, parceiro_nome, percentual_parceiro, unidade")
      .eq("id", modalidadeId)
      .maybeSingle();
    if (modErr) return { ...vazio, error: modErr.message };
    const modalidade = modRow as unknown as ModalidadeRow | null;
    if (!modalidade) return { ...vazio, error: "Modalidade não encontrada." };

    const { data: matRows, error: matErr } = await supabaseAdmin
      .from("esportes_matriculas" as never)
      .select("aluno_id, aluno_nome, turma")
      .eq("modalidade_id", modalidadeId)
      .order("aluno_nome", { ascending: true });
    if (matErr) return { ...vazio, error: matErr.message };
    const matriculas = (matRows ?? []) as unknown as MatriculaRow[];

    const alunos: PagamentoAlunoModalidade[] = [];
    const avisos: string[] = [];

    for (let i = 0; i < matriculas.length; i += CONCORRENCIA_SPONTE) {
      const lote = matriculas.slice(i, i + CONCORRENCIA_SPONTE);
      const resultados = await Promise.all(
        lote.map(async (m) => ({
          matricula: m,
          titulos: await coletarTitulosAluno(modalidade.unidade, m.aluno_id),
        })),
      );
      for (const { matricula, titulos } of resultados) {
        const nome = matricula.aluno_nome || `AlunoID ${matricula.aluno_id}`;
        if (titulos.error || titulos.indisponivel) {
          avisos.push(
            `${nome}: ${titulos.error ?? `integração Sponte indisponível para "${modalidade.unidade}"`}`,
          );
          continue;
        }
        alunos.push(
          pagamentoDoAluno(
            { alunoId: matricula.aluno_id, alunoNome: nome },
            titulos.titulos,
            modalidade.categoria_sponte,
            mesReferencia,
          ),
        );
      }
    }

    const total = totalArrecadado(alunos);
    return {
      modalidadeId,
      mesReferencia,
      alunos,
      avisos,
      ...calcularRepasse(total, Number(modalidade.percentual_parceiro)),
    };
  });
