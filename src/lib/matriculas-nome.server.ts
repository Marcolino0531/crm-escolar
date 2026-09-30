// Atualiza enrollment_submissions.aluno_nome com o nome do aluno no Sponte
// (GetAlunos por AlunoID, com as credenciais da unidade da submissão). Só
// leitura no Sponte. O nome digitado pela família fica em aluno_nome_formulario
// e no payload, que não são alterados aqui (exceto preencher a coluna quando
// ainda estiver vazia, com o nome anterior à atualização).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeAtualizado } from "@/lib/matriculas-nome";
import {
  callSponte,
  checkFault,
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
} from "@/lib/sponte.functions";
import { selectAll } from "@/lib/supabase-paginate";

const COLUNAS = "id, unidade, sponte_aluno_id, aluno_nome, aluno_nome_formulario";

// Depois de tantas falhas seguidas numa unidade, o Sponte dela é dado como fora
// do ar e o restante da unidade fica para a próxima execução.
const FALHAS_SEGUIDAS_MAX = 3;

interface LinhaNome {
  id: string;
  unidade: string | null;
  sponte_aluno_id: number | null;
  aluno_nome: string | null;
  aluno_nome_formulario: string | null;
}

export interface NomeSubmissaoResult {
  alunoNome: string | null;
  atualizado: boolean;
}

export interface SincronizarNomesResult {
  verificadas: number;
  atualizadas: number;
  falhas: { unidade: string; erro: string }[];
}

async function lerNomeAlunoSponte(unidade: string, alunoId: number): Promise<string | null> {
  const creds = resolverCredenciais(unidade);
  if (!creds) throw new Error(`Unidade sem integração com o Sponte: ${unidade}`);
  const xml = await callSponte("GetAlunos", `AlunoID=${alunoId}`, creds.codigoCliente, creds.token);
  const fault = checkFault(xml);
  if (fault) throw new Error(fault);
  const node = parseXmlList(xml, "wsAluno").find((n) =>
    parseXmlValue(n, "RetornoOperacao").startsWith("01"),
  );
  return node ? parseXmlValue(node, "Nome") : null;
}

async function atualizarLinha(linha: LinhaNome): Promise<NomeSubmissaoResult> {
  if (!linha.unidade || !linha.sponte_aluno_id) {
    return { alunoNome: linha.aluno_nome, atualizado: false };
  }
  const novo = nomeAtualizado(
    linha.aluno_nome,
    await lerNomeAlunoSponte(linha.unidade, linha.sponte_aluno_id),
  );
  if (!novo) return { alunoNome: linha.aluno_nome, atualizado: false };
  const campos: Record<string, unknown> = { aluno_nome: novo };
  if (linha.aluno_nome_formulario === null) campos.aluno_nome_formulario = linha.aluno_nome;
  const { error } = await supabaseAdmin
    .from("enrollment_submissions" as never)
    .update(campos as never)
    .eq("id", linha.id);
  if (error) throw new Error(error.message);
  return { alunoNome: novo, atualizado: true };
}

export async function sincronizarNomeSubmissao(id: string): Promise<NomeSubmissaoResult> {
  const { data, error } = await supabaseAdmin
    .from("enrollment_submissions" as never)
    .select(COLUNAS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Submissão não encontrada.");
  return atualizarLinha(data as unknown as LinhaNome);
}

export async function sincronizarNomesMatriculas(): Promise<SincronizarNomesResult> {
  const linhas = await selectAll<LinhaNome>(() =>
    supabaseAdmin
      .from("enrollment_submissions" as never)
      .select(COLUNAS)
      .not("sponte_aluno_id", "is", null)
      .order("id"),
  );
  const porUnidade = new Map<string, LinhaNome[]>();
  for (const l of linhas) {
    if (!l.unidade) continue;
    porUnidade.set(l.unidade, [...(porUnidade.get(l.unidade) ?? []), l]);
  }

  const resultado: SincronizarNomesResult = { verificadas: 0, atualizadas: 0, falhas: [] };
  await Promise.all(
    [...porUnidade.entries()].map(async ([unidade, doGrupo]) => {
      let seguidas = 0;
      let ultimoErro = "";
      let falhasUnidade = 0;
      for (const linha of doGrupo) {
        try {
          const r = await atualizarLinha(linha);
          resultado.verificadas += 1;
          if (r.atualizado) resultado.atualizadas += 1;
          seguidas = 0;
        } catch (e) {
          ultimoErro = e instanceof Error ? e.message : String(e);
          falhasUnidade += 1;
          seguidas += 1;
          if (seguidas >= FALHAS_SEGUIDAS_MAX) break;
        }
      }
      if (falhasUnidade > 0) {
        resultado.falhas.push({ unidade, erro: `${falhasUnidade} falha(s): ${ultimoErro}` });
      }
    }),
  );
  return resultado;
}
