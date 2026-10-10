// Vínculos aluno × ano letivo (diario_matriculas_ano) por AlunoID do Sponte, para
// decidir a unidade do aluno nas bases segmentadas por turma. Falha na leitura
// local ou aluno fora da tabela: mapa sem o aluno (vale só a TurmaAtual).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { UNIDADES_SEGMENTADAS, type VinculoTurma } from "@/lib/aluno-unidades";
import { vinculosAtivosDosAlunos } from "@/lib/diario-matriculas.server";
import { selectAll } from "@/lib/supabase-paginate";

const LOTE = 100;

export async function vinculosPorSponteId(
  sponteIds: readonly string[],
): Promise<Map<string, VinculoTurma[]>> {
  const porAluno = new Map<string, VinculoTurma[]>();
  const ids = [...new Set(sponteIds.filter((id) => id && id !== "0"))];
  if (ids.length === 0) return porAluno;
  try {
    // leitura-restrita: configuração: tabela de colégios
    const { data: escolas, error } = await supabaseAdmin
      .from("schools")
      .select("id")
      .in("name", [...UNIDADES_SEGMENTADAS]);
    if (error) throw error;
    const schoolIds = (escolas ?? []).map((e) => e.id as string);
    if (schoolIds.length === 0) return porAluno;

    const sponteDoStudent = new Map<string, string>();
    for (let i = 0; i < ids.length; i += LOTE) {
      const lote = ids.slice(i, i + LOTE);
      const rows = await selectAll<{ id: string; sponte_aluno_id: string }>(() =>
        supabaseAdmin
          .from("diario_students" as never)
          .select("id, sponte_aluno_id")
          .in("school_id", schoolIds)
          .in("sponte_aluno_id", lote)
          .order("id"),
      );
      for (const r of rows) sponteDoStudent.set(r.id, String(r.sponte_aluno_id));
    }
    if (sponteDoStudent.size === 0) return porAluno;

    for (const v of await vinculosAtivosDosAlunos([...sponteDoStudent.keys()])) {
      const sponteId = sponteDoStudent.get(v.studentId);
      if (!sponteId) continue;
      porAluno.set(sponteId, [
        ...(porAluno.get(sponteId) ?? []),
        { anoLetivo: v.anoLetivo, turmaNome: v.turmaNome },
      ]);
    }
    return porAluno;
  } catch (e) {
    console.error("[aluno-unidades] leitura dos vínculos falhou:", e);
    return new Map();
  }
}
