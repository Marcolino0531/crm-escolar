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
  calcularRepasseModalidade,
  geraRepasseNoMes,
  pagamentoDoAluno,
  statusMesModalidade,
  totalArrecadado,
  type AjustesDoMes,
  type PagamentoAlunoModalidade,
  type ParceiroModalidade,
  type RepasseModalidadeCalculado,
  type StatusMesModalidade,
  type TipoRepasse,
} from "@/lib/esportes-repasse";

// Consultas ao Sponte em paralelo, no mesmo teto usado pela cobrança automática.
const CONCORRENCIA_SPONTE = 5;

interface ModalidadeRow {
  id: string;
  nome: string;
  categoria_sponte: string;
  tipo_repasse: TipoRepasse;
  dia_pagamento: number | null;
  mes_inicio: string | null;
  unidade: string;
}

interface ParceiroRow {
  id: string;
  nome: string;
  percentual_parceiro: number | null;
  valor_fixo_mensal: number | null;
}

interface RepasseAjusteRow {
  parceiro_id: string | null;
  valor_ajustado: number | null;
}

interface MatriculaRow {
  aluno_id: string;
  aluno_nome: string;
  turma: string;
}

export interface ArrecadacaoModalidadeResult extends RepasseModalidadeCalculado {
  modalidadeId: string;
  mesReferencia: string;
  // Janeiro nunca gera repasse (colégio fechado) e mês anterior ao início da
  // modalidade também não; nesses casos os valores vêm zerados.
  statusMes: StatusMesModalidade;
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
      statusMes: "ativo" as StatusMesModalidade,
      alunos: [],
      avisos: [],
      ...calcularRepasseModalidade("percentual", [], 0),
    };

    const { data: modRow, error: modErr } = await supabaseAdmin
      .from("esportes_modalidades" as never)
      .select("id, nome, categoria_sponte, tipo_repasse, dia_pagamento, mes_inicio, unidade")
      .eq("id", modalidadeId)
      .maybeSingle();
    if (modErr) return { ...vazio, error: modErr.message };
    const modalidade = modRow as unknown as ModalidadeRow | null;
    if (!modalidade) return { ...vazio, error: "Modalidade não encontrada." };

    const { data: parcRows, error: parcErr } = await supabaseAdmin
      .from("esportes_parceiros" as never)
      .select("id, nome, percentual_parceiro, valor_fixo_mensal")
      .eq("modalidade_id", modalidadeId)
      .eq("ativo", true)
      .order("ordem", { ascending: true })
      .order("nome", { ascending: true });
    if (parcErr) return { ...vazio, error: parcErr.message };
    const parceiros: ParceiroModalidade[] = ((parcRows ?? []) as unknown as ParceiroRow[]).map(
      (p) => ({
        id: p.id,
        nome: p.nome,
        percentualParceiro: p.percentual_parceiro === null ? null : Number(p.percentual_parceiro),
        valorFixoMensal: p.valor_fixo_mensal === null ? null : Number(p.valor_fixo_mensal),
      }),
    );

    const statusMes = statusMesModalidade(mesReferencia, modalidade.mes_inicio);

    // Mês sem repasse: não vale consultar o Sponte aluno por aluno para depois
    // zerar tudo. A tela explica o motivo pelo statusMes.
    if (!geraRepasseNoMes(mesReferencia, modalidade.mes_inicio)) {
      return {
        ...vazio,
        statusMes,
        ...calcularRepasseModalidade(modalidade.tipo_repasse, [], 0),
      };
    }

    const { data: ajusteRows, error: ajusteErr } = await supabaseAdmin
      .from("esportes_repasses" as never)
      .select("parceiro_id, valor_ajustado")
      .eq("modalidade_id", modalidadeId)
      .eq("mes_referencia", mesReferencia);
    if (ajusteErr) return { ...vazio, statusMes, error: ajusteErr.message };
    const ajustes: AjustesDoMes = {};
    for (const row of (ajusteRows ?? []) as unknown as RepasseAjusteRow[]) {
      if (row.parceiro_id && row.valor_ajustado !== null) {
        ajustes[row.parceiro_id] = Number(row.valor_ajustado);
      }
    }

    const { data: matRows, error: matErr } = await supabaseAdmin
      .from("esportes_matriculas" as never)
      .select("aluno_id, aluno_nome, turma")
      .eq("modalidade_id", modalidadeId)
      .order("aluno_nome", { ascending: true });
    if (matErr) return { ...vazio, statusMes, error: matErr.message };
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
      statusMes,
      alunos,
      avisos,
      ...calcularRepasseModalidade(modalidade.tipo_repasse, parceiros, total, ajustes),
    };
  });
