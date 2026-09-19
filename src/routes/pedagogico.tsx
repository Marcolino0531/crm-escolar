// Secretaria (Pedagógico) — Fase 0: fundação estrutural por unidade × ano letivo.
// Disciplinas, turmas do ano (espelho do Sponte via GetMatriculas), atribuições
// professor × turma × disciplina, calendário letivo e acesso de professores.
// Secretaria/administração entram por canView/canEdit("pedagogico"); o
// professor NÃO passa por aqui (vê só o que a RLS libera em /professor).

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions, useRole, useSchool } from "@/lib/app-context";
import { unidadeAtiva } from "@/lib/unidade-global";
import { SelecioneUnidade } from "@/components/SelecioneUnidade";
import { selectAll } from "@/lib/supabase-paginate";
import { TURMAS_POR_IDADE } from "@/lib/crm/mecCutoff";
import {
  ROTULO_TIPO_CALENDARIO,
  TIPOS_CALENDARIO,
  anoLetivoSugerido,
  atribuicaoDuplicada,
  contarDiasLetivos,
  ehCargoDeProfessor,
  trimestresDoCalendario,
  turmasDoAnoPedagogico,
  validarCalendario,
  type Atribuicao,
  type MatriculaAnoRow,
  type TipoCalendario,
} from "@/lib/pedagogico";
import { syncPedagogicoSponte } from "@/lib/sponte.functions";
import {
  criarAcessoProfessor,
  listarAcessosProfessores,
  revogarAcessoProfessor,
} from "@/lib/admin-users.functions";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/pedagogico")({
  head: () => ({ meta: [{ title: "Secretaria (Pedagógico) — School Hub" }] }),
  component: PedagogicoGate,
});

function PedagogicoGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("pedagogico"))
    return (
      <AccessDenied message="Você não tem permissão para acessar a Secretaria (Pedagógico)." />
    );
  return <PedagogicoPage />;
}

type Disciplina = {
  id: string;
  school_id: string;
  nome: string;
  series: string[];
  ativo: boolean;
};
type Funcionario = {
  id: string;
  nome_completo: string;
  cargo: string | null;
  school_id: string;
  auth_user_id: string | null;
};
type CalendarioRow = {
  id: string;
  school_id: string;
  ano_letivo: number;
  data: string;
  tipo: TipoCalendario;
  trimestre: number | null;
  descricao: string;
};

const ANOS = (() => {
  const base = new Date().getFullYear();
  return [base - 1, base, base + 1, base + 2];
})();

function PedagogicoPage() {
  const { canEdit } = usePermissions();
  const { isAdmin } = useRole();
  const { selected, schools } = useSchool();
  const podeEditar = canEdit("pedagogico");
  const unidadeNome = unidadeAtiva(selected, schools);
  const schoolId = useMemo(
    () => schools.find((s) => s.name === unidadeNome)?.id ?? null,
    [schools, unidadeNome],
  );
  const [ano, setAno] = useState(() => anoLetivoSugerido(new Date()));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Secretaria (Pedagógico)</h1>
          <p className="text-sm text-muted-foreground">
            Fundação do ano letivo: disciplinas, turmas, professores e calendário.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Ano letivo</Label>
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANOS.map((a) => (
                <SelectItem key={a} value={String(a)}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!schoolId ? (
        <SelecioneUnidade acao="A Secretaria" />
      ) : (
        <Tabs defaultValue="turmas">
          <TabsList className="flex-wrap">
            <TabsTrigger value="turmas">Turmas do ano</TabsTrigger>
            <TabsTrigger value="disciplinas">Disciplinas</TabsTrigger>
            <TabsTrigger value="atribuicoes">Atribuições</TabsTrigger>
            <TabsTrigger value="calendario">Calendário letivo</TabsTrigger>
            {isAdmin && <TabsTrigger value="acessos">Acesso de professores</TabsTrigger>}
          </TabsList>
          <TabsContent value="turmas">
            <TurmasDoAno schoolId={schoolId} ano={ano} isAdmin={isAdmin} />
          </TabsContent>
          <TabsContent value="disciplinas">
            <Disciplinas schoolId={schoolId} podeEditar={podeEditar} />
          </TabsContent>
          <TabsContent value="atribuicoes">
            <Atribuicoes schoolId={schoolId} ano={ano} podeEditar={podeEditar} />
          </TabsContent>
          <TabsContent value="calendario">
            <Calendario schoolId={schoolId} ano={ano} podeEditar={podeEditar} />
          </TabsContent>
          {isAdmin && (
            <TabsContent value="acessos">
              <AcessosProfessores schoolId={schoolId} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

// ─── Hooks de dados ─────────────────────────────────────────────────────────

function useMatriculasAno(schoolId: string, ano: number) {
  return useQuery({
    queryKey: ["pedagogico_matriculas_ano", schoolId, ano],
    queryFn: () =>
      selectAll<MatriculaAnoRow & { aluno_nome: string }>(() =>
        supabase
          .from("pedagogico_matriculas_ano" as never)
          .select("school_id, sponte_aluno_id, aluno_nome, ano_letivo, turma_nome, ativo")
          .eq("school_id", schoolId)
          .eq("ano_letivo", ano)
          .eq("ativo", true)
          .order("id"),
      ),
  });
}

function useDisciplinas(schoolId: string) {
  return useQuery({
    queryKey: ["disciplinas", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disciplinas" as never)
        .select("id, school_id, nome, series, ativo")
        .eq("school_id", schoolId)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Disciplina[];
    },
  });
}

function useFuncionarios(schoolId: string) {
  return useQuery({
    queryKey: ["pedagogico_funcionarios", schoolId],
    queryFn: () =>
      selectAll<Funcionario>(() =>
        supabase
          .from("funcionarios")
          .select("id, nome_completo, cargo, school_id, auth_user_id")
          .eq("school_id", schoolId)
          .is("data_rescisao", null)
          .order("nome_completo"),
      ),
  });
}

// ─── Turmas do ano ──────────────────────────────────────────────────────────

function TurmasDoAno({
  schoolId,
  ano,
  isAdmin,
}: {
  schoolId: string;
  ano: number;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const { data: matriculas = [], isLoading } = useMatriculasAno(schoolId, ano);
  const turmas = turmasDoAnoPedagogico(matriculas, schoolId, ano);
  const [turmaAberta, setTurmaAberta] = useState<string | null>(null);

  const sync = useMutation({
    mutationFn: () => syncPedagogicoSponte({ data: { anoLetivo: ano } }),
    onSuccess: (res) => {
      if (res.error) return toast.error(res.error);
      if (res.indisponivel) return toast.warning("Sponte sem contratos vigentes para este ano.");
      toast.success(
        `${ano}: ${res.alunos} aluno(s) em ${res.turmas} turma(s); ${res.inativados} inativado(s).`,
      );
      qc.invalidateQueries({ queryKey: ["pedagogico_matriculas_ano"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          Turmas de {ano} — {matriculas.length} aluno(s) com contrato vigente
        </CardTitle>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
            Sincronizar com o Sponte
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : turmas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma turma sincronizada para {ano}. A sincronização roda toda noite junto com a do
            Diário; um administrador pode rodá-la agora.
          </p>
        ) : (
          <div className="space-y-2">
            {turmas.map((t) => {
              const alunos = matriculas
                .filter((m) => m.turma_nome === t)
                .sort((a, b) => a.aluno_nome.localeCompare(b.aluno_nome, "pt-BR"));
              const aberta = turmaAberta === t;
              return (
                <div key={t} className="rounded-md border">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium hover:bg-accent"
                    onClick={() => setTurmaAberta(aberta ? null : t)}
                  >
                    <span>{t}</span>
                    <Badge variant="secondary">{alunos.length} aluno(s)</Badge>
                  </button>
                  {aberta && (
                    <ul className="border-t px-3 py-2 text-sm">
                      {alunos.map((a) => (
                        <li key={a.sponte_aluno_id} className="py-0.5">
                          {a.aluno_nome}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Disciplinas ────────────────────────────────────────────────────────────

function Disciplinas({ schoolId, podeEditar }: { schoolId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const { data: disciplinas = [] } = useDisciplinas(schoolId);
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<Disciplina | null>(null);
  const [nome, setNome] = useState("");
  const [series, setSeries] = useState<string[]>([]);

  const abrir = (d: Disciplina | null) => {
    setEditando(d);
    setNome(d?.nome ?? "");
    setSeries(d?.series ?? []);
    setOpen(true);
  };

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = { school_id: schoolId, nome: nome.trim(), series, ativo: true };
      if (!payload.nome) throw new Error("Informe o nome da disciplina.");
      const q = editando
        ? supabase
            .from("disciplinas" as never)
            .update(payload as never)
            .eq("id", editando.id)
        : supabase.from("disciplinas" as never).insert(payload as never);
      const { error } = await q;
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Disciplina salva.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["disciplinas", schoolId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("disciplinas" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["disciplinas", schoolId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Disciplinas da unidade</CardTitle>
        {podeEditar && (
          <Button size="sm" onClick={() => abrir(null)}>
            <Plus className="mr-2 h-4 w-4" /> Nova disciplina
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {disciplinas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma disciplina cadastrada.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Séries</TableHead>
                {podeEditar && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {disciplinas.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.nome}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {d.series.length === 0 ? "Todas" : d.series.join(", ")}
                  </TableCell>
                  {podeEditar && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => abrir(d)}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Excluir "${d.nome}"? As atribuições dela também saem.`))
                            excluir.mutate(d.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? "Editar disciplina" : "Nova disciplina"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Matemática"
              />
            </div>
            <div className="space-y-1">
              <Label>Séries em que é ministrada (vazio = todas)</Label>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {TURMAS_POR_IDADE.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={series.includes(s)}
                      onCheckedChange={(v) =>
                        setSeries((prev) => (v ? [...prev, s] : prev.filter((x) => x !== s)))
                      }
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Atribuições ────────────────────────────────────────────────────────────

function Atribuicoes({
  schoolId,
  ano,
  podeEditar,
}: {
  schoolId: string;
  ano: number;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const { data: disciplinas = [] } = useDisciplinas(schoolId);
  const { data: funcionarios = [] } = useFuncionarios(schoolId);
  const { data: matriculas = [] } = useMatriculasAno(schoolId, ano);
  const turmas = turmasDoAnoPedagogico(matriculas, schoolId, ano);
  const { data: atribuicoes = [] } = useQuery({
    queryKey: ["pedagogico_atribuicoes", schoolId, ano],
    queryFn: () =>
      selectAll<Atribuicao>(() =>
        supabase
          .from("pedagogico_atribuicoes" as never)
          .select("id, school_id, professor_id, turma_nome, disciplina_id, ano_letivo")
          .eq("school_id", schoolId)
          .eq("ano_letivo", ano)
          .order("id"),
      ),
  });

  const professores = useMemo(() => {
    const prof = funcionarios.filter((f) => ehCargoDeProfessor(f.cargo));
    return prof.length > 0 ? prof : funcionarios;
  }, [funcionarios]);
  const nomeFunc = new Map(funcionarios.map((f) => [f.id, f.nome_completo]));
  const nomeDisc = new Map(disciplinas.map((d) => [d.id, d.nome]));

  const [professorId, setProfessorId] = useState("");
  const [turma, setTurma] = useState("");
  const [turmaLivre, setTurmaLivre] = useState("");
  const [disciplinaId, setDisciplinaId] = useState("");
  const turmaFinal = turma === "__livre" ? turmaLivre.trim() : turma;

  const criar = useMutation({
    mutationFn: async () => {
      if (!professorId || !turmaFinal || !disciplinaId)
        throw new Error("Escolha professor, turma e disciplina.");
      const nova = {
        school_id: schoolId,
        professor_id: professorId,
        turma_nome: turmaFinal,
        disciplina_id: disciplinaId,
        ano_letivo: ano,
      };
      if (atribuicaoDuplicada(atribuicoes, nova)) throw new Error("Essa atribuição já existe.");
      const { error } = await supabase
        .from("pedagogico_atribuicoes" as never)
        .insert(nova as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Atribuição criada.");
      qc.invalidateQueries({ queryKey: ["pedagogico_atribuicoes", schoolId, ano] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pedagogico_atribuicoes" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pedagogico_atribuicoes", schoolId, ano] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const ordenadas = [...atribuicoes].sort(
    (a, b) =>
      (nomeFunc.get(a.professor_id) ?? "").localeCompare(
        nomeFunc.get(b.professor_id) ?? "",
        "pt-BR",
      ) || a.turma_nome.localeCompare(b.turma_nome, "pt-BR"),
  );

  return (
    <div className="space-y-4">
      {podeEditar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nova atribuição — {ano}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label>Professor</Label>
              <Select value={professorId} onValueChange={setProfessorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {professores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome_completo}
                      {p.cargo ? ` — ${p.cargo}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Turma</Label>
              <Select value={turma} onValueChange={setTurma}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {turmas.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                  <SelectItem value="__livre">Outra (digitar)…</SelectItem>
                </SelectContent>
              </Select>
              {turma === "__livre" && (
                <Input
                  value={turmaLivre}
                  onChange={(e) => setTurmaLivre(e.target.value)}
                  placeholder="Nome exato da turma no Sponte"
                />
              )}
            </div>
            <div className="space-y-1">
              <Label>Disciplina</Label>
              <Select value={disciplinaId} onValueChange={setDisciplinaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {disciplinas.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => criar.mutate()} disabled={criar.isPending} className="w-full">
                <Plus className="mr-2 h-4 w-4" /> Adicionar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Atribuições de {ano}</CardTitle>
        </CardHeader>
        <CardContent>
          {ordenadas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma atribuição para {ano}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Professor</TableHead>
                  <TableHead>Turma</TableHead>
                  <TableHead>Disciplina</TableHead>
                  {podeEditar && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenadas.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{nomeFunc.get(a.professor_id) ?? "—"}</TableCell>
                    <TableCell>{a.turma_nome}</TableCell>
                    <TableCell>{nomeDisc.get(a.disciplina_id) ?? "—"}</TableCell>
                    {podeEditar && (
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => excluir.mutate(a.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Calendário letivo ──────────────────────────────────────────────────────

function Calendario({
  schoolId,
  ano,
  podeEditar,
}: {
  schoolId: string;
  ano: number;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const key = ["pedagogico_calendario", schoolId, ano];
  const { data: dias = [] } = useQuery({
    queryKey: key,
    queryFn: () =>
      selectAll<CalendarioRow>(() =>
        supabase
          .from("pedagogico_calendario" as never)
          .select("id, school_id, ano_letivo, data, tipo, trimestre, descricao")
          .eq("school_id", schoolId)
          .eq("ano_letivo", ano)
          .order("data"),
      ),
  });
  const [data, setData] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [tipo, setTipo] = useState<TipoCalendario>("letivo");
  const [trimestre, setTrimestre] = useState("1");
  const [descricao, setDescricao] = useState("");
  const marcoTrimestre = tipo === "inicio_trimestre" || tipo === "fim_trimestre";

  const tri = trimestresDoCalendario(dias);
  const erros = validarCalendario(dias);

  const adicionar = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("Informe a data.");
      const datas: string[] = [];
      if (tipo === "letivo" && dataFim && dataFim > data) {
        // Intervalo de dias letivos: só segunda a sexta.
        for (
          let d = new Date(`${data}T12:00:00`);
          d.toISOString().slice(0, 10) <= dataFim;
          d.setDate(d.getDate() + 1)
        ) {
          const dow = d.getDay();
          if (dow >= 1 && dow <= 5) datas.push(d.toISOString().slice(0, 10));
        }
      } else datas.push(data);
      const rows = datas.map((d) => ({
        school_id: schoolId,
        ano_letivo: ano,
        data: d,
        tipo,
        trimestre: marcoTrimestre ? Number(trimestre) : null,
        descricao: descricao.trim(),
      }));
      const { error } = await supabase
        .from("pedagogico_calendario" as never)
        .upsert(rows as never, { onConflict: "school_id,ano_letivo,data,tipo" });
      if (error) throw new Error(error.message);
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} registro(s) salvo(s).`);
      setDescricao("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pedagogico_calendario" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  const fmt = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
  const naoLetivos = dias.filter((d) => d.tipo !== "letivo");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        {tri.map((t) => (
          <Card key={t.numero}>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">{t.numero}º trimestre</p>
              <p className="text-sm">
                {fmt(t.inicio)} → {fmt(t.fim)}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase text-muted-foreground">Dias letivos</p>
            <p className="text-2xl font-semibold">{contarDiasLetivos(dias)}</p>
          </CardContent>
        </Card>
      </div>
      {erros.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {erros.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      {podeEditar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Adicionar ao calendário de {ano}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoCalendario)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_CALENDARIO.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ROTULO_TIPO_CALENDARIO[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{tipo === "letivo" ? "De" : "Data"}</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            {tipo === "letivo" ? (
              <div className="space-y-1">
                <Label>Até (opcional, seg–sex)</Label>
                <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>
            ) : marcoTrimestre ? (
              <div className="space-y-1">
                <Label>Trimestre</Label>
                <Select value={trimestre} onValueChange={setTrimestre}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["1", "2", "3"].map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}º
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div />
            )}
            <div className="space-y-1">
              <Label>Descrição</Label>
              <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder={tipo === "feriado" ? "Aniversário da escola" : ""}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => adicionar.mutate()}
                disabled={adicionar.isPending}
                className="w-full"
              >
                <Plus className="mr-2 h-4 w-4" /> Adicionar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feriados, eventos e marcos de {ano}</CardTitle>
        </CardHeader>
        <CardContent>
          {naoLetivos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada cadastrado. Feriados nacionais e de BH já valem em todo o sistema; aqui entram só
              os específicos da unidade.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descrição</TableHead>
                  {podeEditar && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {naoLetivos.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{fmt(d.data)}</TableCell>
                    <TableCell>
                      {ROTULO_TIPO_CALENDARIO[d.tipo]}
                      {d.trimestre ? ` (${d.trimestre}º)` : ""}
                    </TableCell>
                    <TableCell>{d.descricao}</TableCell>
                    {podeEditar && (
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => excluir.mutate(d.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Acesso de professores (admin) ──────────────────────────────────────────

function AcessosProfessores({ schoolId }: { schoolId: string }) {
  const qc = useQueryClient();
  const { data: funcionarios = [] } = useFuncionarios(schoolId);
  const { data: emails = {} } = useQuery({
    queryKey: ["pedagogico_acessos_professores"],
    queryFn: () => listarAcessosProfessores(),
  });
  const [alvo, setAlvo] = useState<Funcionario | null>(null);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["pedagogico_funcionarios"] });
    qc.invalidateQueries({ queryKey: ["pedagogico_acessos_professores"] });
  };
  const criar = useMutation({
    mutationFn: () =>
      criarAcessoProfessor({
        data: { funcionarioId: alvo!.id, email: email.trim(), password: senha },
      }),
    onSuccess: () => {
      toast.success("Acesso criado.");
      setAlvo(null);
      setEmail("");
      setSenha("");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revogar = useMutation({
    mutationFn: (funcionarioId: string) => revogarAcessoProfessor({ data: { funcionarioId } }),
    onSuccess: () => {
      toast.success("Acesso revogado.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = [...funcionarios].sort(
    (a, b) =>
      Number(ehCargoDeProfessor(b.cargo)) - Number(ehCargoDeProfessor(a.cargo)) ||
      a.nome_completo.localeCompare(b.nome_completo, "pt-BR"),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Acesso de professores</CardTitle>
        <p className="text-sm text-muted-foreground">
          O login do professor não recebe nenhum módulo do sistema: ele enxerga apenas as turmas e
          disciplinas das próprias atribuições (aba Atribuições), pela tela &quot;Minhas
          Turmas&quot;.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Funcionário</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Login</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.nome_completo}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{f.cargo ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  {f.auth_user_id ? (
                    <Badge variant="secondary">{emails[f.id] || "com acesso"}</Badge>
                  ) : (
                    <span className="text-muted-foreground">sem acesso</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {f.auth_user_id ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Revogar o acesso de ${f.nome_completo}?`))
                          revogar.mutate(f.id);
                      }}
                    >
                      Revogar
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setAlvo(f)}>
                      <KeyRound className="mr-2 h-4 w-4" /> Gerar acesso
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={alvo !== null} onOpenChange={(o) => !o && setAlvo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar acesso — {alvo?.nome_completo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>E-mail de login</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Senha inicial (mín. 6 caracteres)</Label>
              <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlvo(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => criar.mutate()}
              disabled={criar.isPending || !email.trim() || senha.length < 6}
            >
              Criar acesso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
