// "Minhas Turmas" — visão do professor logado (funcionarios.auth_user_id).
// Não passa por canView("pedagogico"): tudo que aparece aqui é o que a RLS
// libera pelas atribuições do próprio professor. Fase 0: só leitura das
// turmas, disciplinas, alunos e calendário; diário/notas vêm nas fases seguintes.

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectAll } from "@/lib/supabase-paginate";
import { useProfessor } from "@/lib/use-professor";
import {
  ROTULO_TIPO_CALENDARIO,
  anoLetivoSugerido,
  atribuicoesDoProfessor,
  type Atribuicao,
  type MatriculaAnoRow,
  type TipoCalendario,
} from "@/lib/pedagogico";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/professor")({
  head: () => ({ meta: [{ title: "Minhas Turmas — School Hub" }] }),
  component: ProfessorGate,
});

function ProfessorGate() {
  const { professor, loading } = useProfessor();
  if (loading) return null;
  if (!professor)
    return <AccessDenied message="Esta tela é exclusiva de professores com acesso vinculado." />;
  return <ProfessorPage professorId={professor.id} nome={professor.nome_completo} />;
}

type Disciplina = { id: string; nome: string };
type CalendarioRow = {
  id: string;
  data: string;
  tipo: TipoCalendario;
  trimestre: number | null;
  descricao: string;
};

function ProfessorPage({ professorId, nome }: { professorId: string; nome: string }) {
  const [ano, setAno] = useState(() => anoLetivoSugerido(new Date()));
  const anos = [ano - 1, ano, ano + 1];

  const { data: atribuicoes = [] } = useQuery({
    queryKey: ["professor_atribuicoes", professorId],
    queryFn: () =>
      selectAll<Atribuicao>(() =>
        supabase
          .from("pedagogico_atribuicoes" as never)
          .select("id, school_id, professor_id, turma_nome, disciplina_id, ano_letivo")
          .order("id"),
      ),
  });
  const { data: disciplinas = [] } = useQuery({
    queryKey: ["professor_disciplinas", professorId],
    queryFn: () =>
      selectAll<Disciplina>(() =>
        supabase
          .from("disciplinas" as never)
          .select("id, nome")
          .order("nome"),
      ),
  });
  const { data: alunos = [] } = useQuery({
    queryKey: ["professor_alunos", professorId, ano],
    queryFn: () =>
      selectAll<MatriculaAnoRow & { aluno_nome: string }>(() =>
        supabase
          .from("pedagogico_matriculas_ano" as never)
          .select("school_id, sponte_aluno_id, aluno_nome, ano_letivo, turma_nome, ativo")
          .eq("ano_letivo", ano)
          .eq("ativo", true)
          .order("aluno_nome"),
      ),
  });
  const { data: calendario = [] } = useQuery({
    queryKey: ["professor_calendario", professorId, ano],
    queryFn: () =>
      selectAll<CalendarioRow>(() =>
        supabase
          .from("pedagogico_calendario" as never)
          .select("id, data, tipo, trimestre, descricao")
          .eq("ano_letivo", ano)
          .neq("tipo", "letivo")
          .order("data"),
      ),
  });

  const turmas = atribuicoesDoProfessor(atribuicoes, professorId, ano);
  const nomeDisc = new Map(disciplinas.map((d) => [d.id, d.nome]));
  const fmt = (d: string) => d.split("-").reverse().join("/");

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Minhas Turmas</h1>
          <p className="text-sm text-muted-foreground">{nome}</p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Ano letivo</Label>
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {anos.map((a) => (
                <SelectItem key={a} value={String(a)}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {turmas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma turma atribuída a você em {ano}. Procure a secretaria.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {turmas.map((t) => {
            const lista = alunos.filter((a) => a.turma_nome === t.turmaNome);
            return (
              <Card key={t.turmaNome}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{t.turmaNome}</span>
                    <Badge variant="secondary">{lista.length} aluno(s)</Badge>
                  </CardTitle>
                  <div className="flex flex-wrap gap-1">
                    {t.disciplinaIds.map((id) => (
                      <Badge key={id} variant="outline">
                        {nomeDisc.get(id) ?? "Disciplina"}
                      </Badge>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  {lista.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Turma ainda sem alunos sincronizados.
                    </p>
                  ) : (
                    <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                      {lista.map((a) => (
                        <li key={a.sponte_aluno_id}>{a.aluno_nome}</li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {calendario.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Calendário letivo {ano}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {calendario.map((d) => (
                <li key={d.id} className="flex gap-3">
                  <span className="w-24 tabular-nums">{fmt(d.data)}</span>
                  <span className="text-muted-foreground">
                    {ROTULO_TIPO_CALENDARIO[d.tipo]}
                    {d.trimestre ? ` (${d.trimestre}º)` : ""}
                  </span>
                  <span>{d.descricao}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
