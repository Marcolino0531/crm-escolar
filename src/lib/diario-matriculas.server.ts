// Leitura dos vínculos aluno × ano letivo do Diário (diario_matriculas_ano)
// pelo servidor. Telas com ano letivo usam a turma DO ANO, não o class_name
// "mais recente" de diario_students.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/supabase-paginate";
import type { VinculoAno } from "@/lib/diario-sync";

type VinculoRow = {
  student_id: string;
  ano_letivo: number;
  turma_nome: string;
  ativo: boolean;
};

// Vínculos ATIVOS dos alunos informados (todos os anos, ou só os anos pedidos).
export async function vinculosAtivosDosAlunos(
  studentIds: readonly string[],
  anos?: readonly number[],
): Promise<VinculoAno[]> {
  if (studentIds.length === 0) return [];
  // Sem .in() por aluno: centenas de IDs estouram o limite de URL do PostgREST.
  const rows = await selectAll<VinculoRow>(() => {
    let q = supabaseAdmin
      .from("diario_matriculas_ano" as never)
      .select("student_id, ano_letivo, turma_nome, ativo")
      .eq("ativo", true)
      .order("id");
    if (anos && anos.length > 0) q = q.in("ano_letivo", [...new Set(anos)]);
    return q;
  });
  const ids = new Set(studentIds);
  return rows
    .filter((r) => ids.has(r.student_id))
    .map((r) => ({
      studentId: r.student_id,
      anoLetivo: Number(r.ano_letivo),
      turmaNome: r.turma_nome,
      ativo: r.ativo,
    }));
}
