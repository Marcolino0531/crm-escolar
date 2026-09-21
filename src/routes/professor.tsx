// "Minhas Turmas" — visão do professor logado (funcionarios.auth_user_id).
// Não passa por canView("pedagogico"): tudo que aparece aqui é o que a RLS
// libera pelas atribuições do próprio professor. Fase 1: diário de classe do
// dia — aulas do dia (grade), conteúdo ministrado e frequência por aula.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { selectAll } from "@/lib/supabase-paginate";
import { useProfessor } from "@/lib/use-professor";
import {
  ROTULO_DIA_SEMANA,
  ROTULO_TIPO_CALENDARIO,
  anoLetivoSugerido,
  atribuicoesDoProfessor,
  aulasDoDia,
  diaSemanaISO,
  filtrarPorAtribuicao,
  montarChamada,
  resumoChamada,
  validarLancamento,
  type Atribuicao,
  type AulaDoDia,
  type ChamadaAluno,
  type ConteudoRow,
  type FrequenciaRow,
  type Horario,
  type MatriculaAnoRow,
  type TipoCalendario,
} from "@/lib/pedagogico";
import { segmentoDaTurma } from "@/lib/pedagogico-notas";
import { Avaliacoes } from "@/components/pedagogico/Avaliacoes";
import { Pareceres } from "@/components/pedagogico/Pareceres";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

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
type AlunoRow = MatriculaAnoRow & { aluno_nome: string };

const hojeYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const somarDias = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};
const fmt = (d: string) => d.split("-").reverse().join("/");

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
      selectAll<AlunoRow>(() =>
        supabase
          .from("pedagogico_matriculas_ano" as never)
          .select("school_id, sponte_aluno_id, aluno_nome, ano_letivo, turma_nome, ativo")
          .eq("ano_letivo", ano)
          .eq("ativo", true)
          .order("aluno_nome"),
      ),
  });
  const { data: horarios = [] } = useQuery({
    queryKey: ["professor_horarios", professorId, ano],
    queryFn: () =>
      selectAll<Horario>(() =>
        supabase
          .from("pedagogico_horarios" as never)
          .select(
            "id, school_id, ano_letivo, turma_nome, disciplina_id, dia_semana, horario_inicio, horario_fim",
          )
          .eq("ano_letivo", ano)
          .order("dia_semana")
          .order("horario_inicio"),
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
        <Tabs defaultValue="diario">
          <TabsList>
            <TabsTrigger value="diario">Diário do dia</TabsTrigger>
            <TabsTrigger value="avaliacoes">Avaliações e pareceres</TabsTrigger>
            <TabsTrigger value="turmas">Turmas</TabsTrigger>
          </TabsList>
          <TabsContent value="avaliacoes">
            <AvaliacoesProfessor
              professorId={professorId}
              ano={ano}
              atribuicoes={atribuicoes}
              alunos={alunos}
              nomeDisc={nomeDisc}
            />
          </TabsContent>
          <TabsContent value="diario">
            <DiarioDoDia
              professorId={professorId}
              ano={ano}
              atribuicoes={atribuicoes}
              horarios={horarios}
              alunos={alunos}
              nomeDisc={nomeDisc}
            />
          </TabsContent>
          <TabsContent value="turmas">
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
          </TabsContent>
        </Tabs>
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

// ─── Avaliações (Fundamental) / Pareceres (Infantil) ───────────────────────

function AvaliacoesProfessor({
  professorId,
  ano,
  atribuicoes,
  alunos,
  nomeDisc,
}: {
  professorId: string;
  ano: number;
  atribuicoes: Atribuicao[];
  alunos: AlunoRow[];
  nomeDisc: Map<string, string>;
}) {
  const minhas = atribuicoes.filter((a) => a.professor_id === professorId && a.ano_letivo === ano);
  const turmas = [...new Map(minhas.map((a) => [`${a.school_id}|${a.turma_nome}`, a])).values()];
  const [turmaKey, setTurmaKey] = useState("");
  const turma = turmas.find((t) => `${t.school_id}|${t.turma_nome}` === turmaKey) ?? turmas[0];
  const discs = turma
    ? minhas.filter((a) => a.school_id === turma.school_id && a.turma_nome === turma.turma_nome)
    : [];
  const [discId, setDiscId] = useState("");
  const disc = discs.find((d) => d.disciplina_id === discId) ?? discs[0];
  if (!turma) return null;

  const segmento = segmentoDaTurma(turma.turma_nome);
  const lista = alunos.filter(
    (a) => a.school_id === turma.school_id && a.turma_nome === turma.turma_nome,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Turma</Label>
          <Select
            value={`${turma.school_id}|${turma.turma_nome}`}
            onValueChange={(v) => {
              setTurmaKey(v);
              setDiscId("");
            }}
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {turmas.map((t) => (
                <SelectItem
                  key={`${t.school_id}|${t.turma_nome}`}
                  value={`${t.school_id}|${t.turma_nome}`}
                >
                  {t.turma_nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {segmento === "fundamental" && disc && (
          <div className="flex items-center gap-2">
            <Label className="text-sm">Disciplina</Label>
            <Select value={disc.disciplina_id} onValueChange={setDiscId}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {discs.map((d) => (
                  <SelectItem key={d.disciplina_id} value={d.disciplina_id}>
                    {nomeDisc.get(d.disciplina_id) ?? "Disciplina"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {segmento === "infantil" ? (
        <Pareceres
          schoolId={turma.school_id}
          ano={ano}
          turmaNome={turma.turma_nome}
          alunos={lista}
          professorId={professorId}
          podeEditar
        />
      ) : segmento === "fundamental" && disc ? (
        <Avaliacoes
          schoolId={turma.school_id}
          ano={ano}
          turmaNome={turma.turma_nome}
          disciplinaId={disc.disciplina_id}
          disciplinaNome={nomeDisc.get(disc.disciplina_id) ?? "Disciplina"}
          alunos={lista}
          lancadorId={professorId}
          podeEditar
          podeLancarRecuperacaoFinal={false}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Não foi possível identificar o segmento (Infantil ou Fundamental) da turma "
          {turma.turma_nome}". Procure a secretaria.
        </p>
      )}
    </div>
  );
}

// ─── Diário do dia ──────────────────────────────────────────────────────────

function DiarioDoDia({
  professorId,
  ano,
  atribuicoes,
  horarios,
  alunos,
  nomeDisc,
}: {
  professorId: string;
  ano: number;
  atribuicoes: Atribuicao[];
  horarios: Horario[];
  alunos: AlunoRow[];
  nomeDisc: Map<string, string>;
}) {
  const [data, setData] = useState(() => {
    const h = hojeYMD();
    return Number(h.slice(0, 4)) === ano ? h : `${ano}-02-01`;
  });
  useEffect(() => {
    if (Number(data.slice(0, 4)) !== ano) setData(`${ano}-02-01`);
  }, [ano, data]);

  const { data: conteudos = [] } = useQuery({
    queryKey: ["professor_conteudos", professorId, data],
    queryFn: () =>
      selectAll<ConteudoRow & { id: string }>(() =>
        supabase
          .from("pedagogico_conteudos" as never)
          .select(
            "id, school_id, ano_letivo, turma_nome, disciplina_id, professor_id, data, conteudo, licao_casa",
          )
          .eq("data", data)
          .order("id"),
      ),
  });
  const { data: frequencias = [] } = useQuery({
    queryKey: ["professor_frequencia", professorId, data],
    queryFn: () =>
      selectAll<FrequenciaRow>(() =>
        supabase
          .from("pedagogico_frequencia" as never)
          .select(
            "school_id, ano_letivo, turma_nome, disciplina_id, data, sponte_aluno_id, presente",
          )
          .eq("data", data)
          .order("id"),
      ),
  });

  const aulas = aulasDoDia(horarios, atribuicoes, professorId, data);
  const meusConteudos = filtrarPorAtribuicao(conteudos, atribuicoes, professorId);
  const minhasFreq = filtrarPorAtribuicao(frequencias, atribuicoes, professorId);
  const dia = diaSemanaISO(data);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setData(somarDias(data, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={data}
          onChange={(e) => e.target.value && setData(e.target.value)}
          className="w-44"
        />
        <Button variant="outline" size="icon" onClick={() => setData(somarDias(data, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">{ROTULO_DIA_SEMANA[dia]}</span>
        <Button variant="ghost" size="sm" onClick={() => setData(hojeYMD())}>
          Hoje
        </Button>
      </div>

      {aulas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma aula sua na grade em {fmt(data)}.</p>
      ) : (
        aulas.map((aula) => {
          const k = `${aula.schoolId}|${aula.turmaNome}|${aula.disciplinaId}|${aula.horarioInicio ?? ""}`;
          const conteudo = meusConteudos.find(
            (c) =>
              c.school_id === aula.schoolId &&
              c.turma_nome === aula.turmaNome &&
              c.disciplina_id === aula.disciplinaId,
          );
          const lancadas = minhasFreq.filter(
            (f) =>
              f.school_id === aula.schoolId &&
              f.turma_nome === aula.turmaNome &&
              f.disciplina_id === aula.disciplinaId,
          );
          return (
            <AulaCard
              key={k}
              professorId={professorId}
              atribuicoes={atribuicoes}
              aula={aula}
              data={data}
              nomeDisciplina={nomeDisc.get(aula.disciplinaId) ?? "Disciplina"}
              conteudo={conteudo ?? null}
              chamada={montarChamada(
                alunos,
                aula.schoolId,
                aula.anoLetivo,
                aula.turmaNome,
                lancadas,
              )}
              temChamada={lancadas.length > 0}
            />
          );
        })
      )}
    </div>
  );
}

function AulaCard({
  professorId,
  atribuicoes,
  aula,
  data,
  nomeDisciplina,
  conteudo,
  chamada,
  temChamada,
}: {
  professorId: string;
  atribuicoes: Atribuicao[];
  aula: AulaDoDia;
  data: string;
  nomeDisciplina: string;
  conteudo: (ConteudoRow & { id: string }) | null;
  chamada: ChamadaAluno[];
  temChamada: boolean;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState(conteudo?.conteudo ?? "");
  const [licao, setLicao] = useState(conteudo?.licao_casa ?? "");
  const [presencas, setPresencas] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setTexto(conteudo?.conteudo ?? "");
    setLicao(conteudo?.licao_casa ?? "");
    setPresencas({});
  }, [conteudo, data]);

  const chamadaAtual = chamada.map((c) => ({
    ...c,
    presente: presencas[c.sponteAlunoId] ?? c.presente,
  }));
  const resumo = resumoChamada(chamadaAtual);

  const lancamento = {
    professorId,
    schoolId: aula.schoolId,
    anoLetivo: aula.anoLetivo,
    turmaNome: aula.turmaNome,
    disciplinaId: aula.disciplinaId,
    data,
  };
  const base = {
    school_id: aula.schoolId,
    ano_letivo: aula.anoLetivo,
    turma_nome: aula.turmaNome,
    disciplina_id: aula.disciplinaId,
    professor_id: professorId,
    data,
  };

  const salvarConteudo = useMutation({
    mutationFn: async () => {
      const erro = validarLancamento(atribuicoes, lancamento);
      if (erro) throw new Error(erro);
      if (!texto.trim()) throw new Error("Descreva o conteúdo ministrado.");
      const { error } = await supabase.from("pedagogico_conteudos" as never).upsert(
        {
          ...base,
          conteudo: texto.trim(),
          licao_casa: licao.trim() || null,
        } as never,
        { onConflict: "school_id,ano_letivo,turma_nome,disciplina_id,data" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Conteúdo salvo.");
      qc.invalidateQueries({ queryKey: ["professor_conteudos", professorId, data] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarFrequencia = useMutation({
    mutationFn: async () => {
      const erro = validarLancamento(atribuicoes, lancamento);
      if (erro) throw new Error(erro);
      if (chamadaAtual.length === 0) throw new Error("Turma sem alunos sincronizados.");
      const linhas = chamadaAtual.map((c) => ({
        ...base,
        sponte_aluno_id: c.sponteAlunoId,
        presente: c.presente,
      }));
      const { error } = await supabase
        .from("pedagogico_frequencia" as never)
        .upsert(linhas as never, {
          onConflict: "school_id,ano_letivo,turma_nome,disciplina_id,data,sponte_aluno_id",
        });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Frequência salva.");
      setPresencas({});
      qc.invalidateQueries({ queryKey: ["professor_frequencia", professorId, data] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>
            {aula.turmaNome} · {nomeDisciplina}
          </span>
          <span className="flex items-center gap-2">
            {aula.horarioInicio ? (
              <Badge variant="outline" className="tabular-nums">
                {aula.horarioInicio}–{aula.horarioFim}
              </Badge>
            ) : (
              <Badge variant="secondary">Sem horário na grade</Badge>
            )}
            {conteudo && <Badge>Conteúdo lançado</Badge>}
            {temChamada && <Badge>Chamada feita</Badge>}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Conteúdo ministrado</Label>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={4}
              placeholder="O que foi trabalhado nesta aula"
            />
          </div>
          <div className="space-y-1">
            <Label>Lição de casa (opcional)</Label>
            <Textarea
              value={licao}
              onChange={(e) => setLicao(e.target.value)}
              rows={2}
              placeholder="Tarefa para casa, se houver"
            />
          </div>
          <Button onClick={() => salvarConteudo.mutate()} disabled={salvarConteudo.isPending}>
            <Save className="mr-2 h-4 w-4" /> Salvar conteúdo
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Frequência</Label>
            <span className="text-xs text-muted-foreground">
              {resumo.presentes} presente(s) · {resumo.faltas} falta(s) de {resumo.total}
            </span>
          </div>
          {chamadaAtual.length === 0 ? (
            <p className="text-sm text-muted-foreground">Turma ainda sem alunos sincronizados.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
              {chamadaAtual.map((c) => (
                <li key={c.sponteAlunoId} className="flex items-center justify-between gap-2">
                  <span className={c.presente ? "" : "text-destructive"}>{c.nome}</span>
                  <span className="flex items-center gap-2">
                    <span className="w-14 text-right text-xs text-muted-foreground">
                      {c.presente ? "Presente" : "Falta"}
                    </span>
                    <Switch
                      checked={c.presente}
                      onCheckedChange={(v) => setPresencas((p) => ({ ...p, [c.sponteAlunoId]: v }))}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            onClick={() => salvarFrequencia.mutate()}
            disabled={salvarFrequencia.isPending || chamadaAtual.length === 0}
          >
            <Save className="mr-2 h-4 w-4" /> Salvar frequência
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
