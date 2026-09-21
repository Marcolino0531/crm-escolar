// Avaliações e notas de uma turma × disciplina (Fundamental em diante).
// Usado pelo professor (/professor) e pela secretaria (/pedagogico): a RLS
// decide o que cada um consegue gravar; aqui só escondemos o que não cabe
// (recuperação final é exclusiva da secretaria).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { selectAll } from "@/lib/supabase-paginate";
import {
  MEDIA_ANUAL,
  ROTULO_SITUACAO,
  TRIMESTRES,
  VALOR_RECUPERACAO_FINAL,
  VALOR_RECUPERACAO_TRIMESTRE,
  VALOR_TRIMESTRE,
  atividadesDoTrimestre,
  boletimDisciplina,
  fmtNota,
  mediaTrimestre,
  validarAtividade,
  validarNota,
  validarRecuperacaoFinal,
  validarRecuperacaoTrimestre,
  valorDistribuido,
  type AtividadeAvaliativa,
  type NotaRow,
  type RecuperacaoFinalRow,
  type RecuperacaoTrimestreRow,
  type SituacaoAnual,
  type Trimestre,
} from "@/lib/pedagogico-notas";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface AlunoDaTurma {
  sponte_aluno_id: string;
  aluno_nome: string;
}

interface Props {
  schoolId: string;
  ano: number;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  alunos: AlunoDaTurma[];
  // funcionarios.id de quem está lançando (professor ou usuário da secretaria vinculado).
  lancadorId: string | null;
  podeEditar: boolean;
  // Só a secretaria lança a recuperação final.
  podeLancarRecuperacaoFinal: boolean;
}

type NotaDb = NotaRow & { id: string };
type RecTriDb = RecuperacaoTrimestreRow & { id: string };
type RecFinalDb = RecuperacaoFinalRow & { id: string };

const parseNota = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const corSituacao: Record<SituacaoAnual, "default" | "secondary" | "destructive" | "outline"> = {
  em_andamento: "outline",
  aprovado: "default",
  recuperacao_final: "destructive",
  aprovado_recuperacao: "secondary",
  reprovado: "destructive",
};

export function Avaliacoes({
  schoolId,
  ano,
  turmaNome,
  disciplinaId,
  disciplinaNome,
  alunos,
  lancadorId,
  podeEditar,
  podeLancarRecuperacaoFinal,
}: Props) {
  const qc = useQueryClient();
  const chave = {
    school_id: schoolId,
    ano_letivo: ano,
    turma_nome: turmaNome,
    disciplina_id: disciplinaId,
  };
  const keyBase = ["pedagogico_notas", schoolId, ano, turmaNome, disciplinaId];
  const [trimestre, setTrimestre] = useState<Trimestre>(1);

  const { data: atividades = [] } = useQuery({
    queryKey: [...keyBase, "atividades"],
    queryFn: () =>
      selectAll<AtividadeAvaliativa>(() =>
        supabase
          .from("pedagogico_atividades_avaliativas" as never)
          .select(
            "id, school_id, ano_letivo, turma_nome, disciplina_id, professor_id, trimestre, nome, valor_maximo, data",
          )
          .match(chave)
          .order("data"),
      ),
  });
  const idsAtividades = atividades.map((a) => a.id);
  const { data: notas = [] } = useQuery({
    queryKey: [...keyBase, "notas", idsAtividades.join(",")],
    enabled: idsAtividades.length > 0,
    queryFn: () =>
      selectAll<NotaDb>(() =>
        supabase
          .from("pedagogico_notas" as never)
          .select("id, atividade_id, sponte_aluno_id, nota")
          .in("atividade_id", idsAtividades)
          .order("id"),
      ),
  });
  const { data: recuperacoes = [] } = useQuery({
    queryKey: [...keyBase, "rec_tri"],
    queryFn: () =>
      selectAll<RecTriDb>(() =>
        supabase
          .from("pedagogico_recuperacoes_trimestre" as never)
          .select(
            "id, school_id, ano_letivo, turma_nome, disciplina_id, trimestre, sponte_aluno_id, nota",
          )
          .match(chave)
          .order("id"),
      ),
  });
  const { data: recuperacoesFinais = [] } = useQuery({
    queryKey: [...keyBase, "rec_final"],
    queryFn: () =>
      selectAll<RecFinalDb>(() =>
        supabase
          .from("pedagogico_recuperacoes_finais" as never)
          .select("id, school_id, ano_letivo, turma_nome, disciplina_id, sponte_aluno_id, nota")
          .match(chave)
          .order("id"),
      ),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: keyBase });
  const erro = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

  // ── Atividades ──
  const [novaNome, setNovaNome] = useState("");
  const [novaValor, setNovaValor] = useState("");
  const [novaData, setNovaData] = useState(`${ano}-03-01`);

  const criarAtividade = useMutation({
    mutationFn: async () => {
      if (!lancadorId) throw new Error("Seu usuário não está vinculado a um funcionário.");
      const nova = {
        ...chave,
        professor_id: lancadorId,
        trimestre,
        nome: novaNome,
        valor_maximo: parseNota(novaValor) ?? 0,
        data: novaData,
      };
      const msg = validarAtividade(atividades, nova);
      if (msg) throw new Error(msg);
      const { error } = await supabase
        .from("pedagogico_atividades_avaliativas" as never)
        .insert({ ...nova, nome: nova.nome.trim() } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      setNovaNome("");
      setNovaValor("");
      invalidar();
      toast.success("Atividade criada.");
    },
    onError: erro,
  });
  const excluirAtividade = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pedagogico_atividades_avaliativas" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      toast.success("Atividade excluída (com as notas lançadas nela).");
    },
    onError: erro,
  });

  // ── Notas / recuperações ──
  const salvarNota = useMutation({
    mutationFn: async (p: { atividade: AtividadeAvaliativa; alunoId: string; valor: string }) => {
      const existente = notas.find(
        (n) => n.atividade_id === p.atividade.id && n.sponte_aluno_id === p.alunoId,
      );
      const nota = parseNota(p.valor);
      if (nota == null) {
        if (!existente) return;
        const { error } = await supabase
          .from("pedagogico_notas" as never)
          .delete()
          .eq("id", existente.id);
        if (error) throw error;
        return;
      }
      const msg = validarNota(nota, Number(p.atividade.valor_maximo));
      if (msg) throw new Error(msg);
      const { error } = await supabase.from("pedagogico_notas" as never).upsert(
        {
          atividade_id: p.atividade.id,
          sponte_aluno_id: p.alunoId,
          nota,
          lancado_por: lancadorId,
        } as never,
        { onConflict: "atividade_id,sponte_aluno_id" },
      );
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: erro,
  });

  const salvarRecuperacao = useMutation({
    mutationFn: async (p: { alunoId: string; valor: string }) => {
      const existente = recuperacoes.find(
        (r) => r.trimestre === trimestre && r.sponte_aluno_id === p.alunoId,
      );
      const nota = parseNota(p.valor);
      if (nota == null) {
        if (!existente) return;
        const { error } = await supabase
          .from("pedagogico_recuperacoes_trimestre" as never)
          .delete()
          .eq("id", existente.id);
        if (error) throw error;
        return;
      }
      const msg = validarRecuperacaoTrimestre(trimestre, nota);
      if (msg) throw new Error(msg);
      const { error } = await supabase.from("pedagogico_recuperacoes_trimestre" as never).upsert(
        {
          ...chave,
          trimestre,
          sponte_aluno_id: p.alunoId,
          nota,
          lancado_por: lancadorId,
        } as never,
        { onConflict: "school_id,ano_letivo,turma_nome,disciplina_id,trimestre,sponte_aluno_id" },
      );
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: erro,
  });

  const salvarRecuperacaoFinal = useMutation({
    mutationFn: async (p: { alunoId: string; valor: string }) => {
      const existente = recuperacoesFinais.find((r) => r.sponte_aluno_id === p.alunoId);
      const nota = parseNota(p.valor);
      if (nota == null) {
        if (!existente) return;
        const { error } = await supabase
          .from("pedagogico_recuperacoes_finais" as never)
          .delete()
          .eq("id", existente.id);
        if (error) throw error;
        return;
      }
      const msg = validarRecuperacaoFinal(nota);
      if (msg) throw new Error(msg);
      const { error } = await supabase
        .from("pedagogico_recuperacoes_finais" as never)
        .upsert({ ...chave, sponte_aluno_id: p.alunoId, nota, lancado_por: lancadorId } as never, {
          onConflict: "school_id,ano_letivo,turma_nome,disciplina_id,sponte_aluno_id",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      toast.success("Recuperação final lançada.");
    },
    onError: erro,
  });

  const ativsTri = atividadesDoTrimestre(atividades, chave, trimestre);
  const distribuido = valorDistribuido(atividades, chave, trimestre);
  const total = VALOR_TRIMESTRE[trimestre];
  const boletins = new Map(
    alunos.map((a) => [
      a.sponte_aluno_id,
      boletimDisciplina(
        chave,
        a.sponte_aluno_id,
        atividades,
        notas,
        recuperacoes,
        recuperacoesFinais,
      ),
    ]),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Trimestre</Label>
          <Select
            value={String(trimestre)}
            onValueChange={(v) => setTrimestre(Number(v) as Trimestre)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIMESTRES.map((t) => (
                <SelectItem key={t} value={String(t)}>
                  {t}º trimestre ({VALOR_TRIMESTRE[t]} pts)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant={distribuido > total ? "destructive" : "secondary"}>
          {fmtNota(distribuido)} / {total} pontos distribuídos · média{" "}
          {fmtNota(mediaTrimestre(trimestre))}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Atividades avaliativas — {disciplinaNome} · {turmaNome} · {trimestre}º trimestre
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {podeEditar && (
            <div className="grid gap-2 md:grid-cols-[1fr_120px_160px_auto]">
              <Input
                placeholder="Nome (ex.: Prova 1, Trabalho em grupo)"
                value={novaNome}
                onChange={(e) => setNovaNome(e.target.value)}
              />
              <Input
                placeholder={`Valor (resta ${fmtNota(Math.max(0, total - distribuido))})`}
                inputMode="decimal"
                value={novaValor}
                onChange={(e) => setNovaValor(e.target.value)}
              />
              <Input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} />
              <Button
                onClick={() => criarAtividade.mutate()}
                disabled={criarAtividade.isPending || !novaNome.trim() || !novaValor.trim()}
              >
                <Plus className="mr-1 h-4 w-4" /> Adicionar
              </Button>
            </div>
          )}
          {ativsTri.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma atividade neste trimestre.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-sm">
              {ativsTri.map((a) => (
                <li key={a.id} className="flex items-center gap-1 rounded border px-2 py-1">
                  <span className="font-medium">{a.nome}</span>
                  <span className="text-muted-foreground">
                    · {fmtNota(Number(a.valor_maximo))} pts ·{" "}
                    {a.data.split("-").reverse().join("/")}
                  </span>
                  {podeEditar && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title="Excluir atividade"
                      onClick={() => {
                        if (confirm(`Excluir "${a.nome}" e todas as notas lançadas nela?`))
                          excluirAtividade.mutate(a.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notas do {trimestre}º trimestre</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {alunos.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Turma sem alunos sincronizados.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Aluno</TableHead>
                  {ativsTri.map((a) => (
                    <TableHead key={a.id} className="text-center">
                      {a.nome}
                      <div className="text-xs font-normal text-muted-foreground">
                        /{fmtNota(Number(a.valor_maximo))}
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="text-center">Nota do tri.</TableHead>
                  {trimestre !== 3 && (
                    <>
                      <TableHead className="text-center">
                        Recuperação
                        <div className="text-xs font-normal text-muted-foreground">
                          /{VALOR_RECUPERACAO_TRIMESTRE}
                        </div>
                      </TableHead>
                      <TableHead className="text-center">Nota final do tri.</TableHead>
                    </>
                  )}
                  <TableHead className="text-center">Soma anual</TableHead>
                  <TableHead>Situação</TableHead>
                  {trimestre === 3 && (
                    <TableHead className="text-center">
                      Rec. final
                      <div className="text-xs font-normal text-muted-foreground">
                        /{VALOR_RECUPERACAO_FINAL}
                      </div>
                    </TableHead>
                  )}
                  <TableHead className="text-center">Nota final do ano</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alunos.map((al) => {
                  const b = boletins.get(al.sponte_aluno_id)!;
                  const tri = b.trimestres[trimestre - 1];
                  const recFinalRow = recuperacoesFinais.find(
                    (r) => r.sponte_aluno_id === al.sponte_aluno_id,
                  );
                  const mostraRecFinal =
                    b.situacao === "recuperacao_final" ||
                    b.situacao === "aprovado_recuperacao" ||
                    b.situacao === "reprovado";
                  return (
                    <TableRow key={al.sponte_aluno_id}>
                      <TableCell className="font-medium">{al.aluno_nome}</TableCell>
                      {ativsTri.map((a) => {
                        const n = notas.find(
                          (x) =>
                            x.atividade_id === a.id && x.sponte_aluno_id === al.sponte_aluno_id,
                        );
                        return (
                          <TableCell key={a.id} className="text-center">
                            <NotaInput
                              valor={n ? fmtNota(Number(n.nota)) : ""}
                              disabled={!podeEditar}
                              onSalvar={(v) =>
                                salvarNota.mutate({
                                  atividade: a,
                                  alunoId: al.sponte_aluno_id,
                                  valor: v,
                                })
                              }
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center tabular-nums">
                        <span className={tri.abaixoDaMedia ? "font-semibold text-destructive" : ""}>
                          {fmtNota(tri.nota)}
                        </span>
                        {tri.abaixoDaMedia && (
                          <div className="text-xs text-destructive">abaixo da média</div>
                        )}
                      </TableCell>
                      {trimestre !== 3 && (
                        <>
                          <TableCell className="text-center">
                            {tri.podeRecuperar || tri.recuperacao != null ? (
                              <NotaInput
                                valor={tri.recuperacao == null ? "" : fmtNota(tri.recuperacao)}
                                disabled={!podeEditar}
                                onSalvar={(v) =>
                                  salvarRecuperacao.mutate({
                                    alunoId: al.sponte_aluno_id,
                                    valor: v,
                                  })
                                }
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {fmtNota(tri.notaFinal)}
                          </TableCell>
                        </>
                      )}
                      <TableCell className="text-center tabular-nums">
                        <span className={b.precisaRecuperacaoFinal ? "text-destructive" : ""}>
                          {fmtNota(b.somaAnual)}
                        </span>
                        <span className="text-xs text-muted-foreground"> /{MEDIA_ANUAL}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={corSituacao[b.situacao]}>
                          {ROTULO_SITUACAO[b.situacao]}
                        </Badge>
                      </TableCell>
                      {trimestre === 3 && (
                        <TableCell className="text-center">
                          {mostraRecFinal ? (
                            <NotaInput
                              valor={recFinalRow ? fmtNota(Number(recFinalRow.nota)) : ""}
                              disabled={!podeLancarRecuperacaoFinal}
                              onSalvar={(v) =>
                                salvarRecuperacaoFinal.mutate({
                                  alunoId: al.sponte_aluno_id,
                                  valor: v,
                                })
                              }
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-center font-semibold tabular-nums">
                        {fmtNota(b.notaFinalAno)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Campo de nota que grava ao sair (blur) ou Enter; vazio apaga o lançamento.
function NotaInput({
  valor,
  disabled,
  onSalvar,
}: {
  valor: string;
  disabled: boolean;
  onSalvar: (v: string) => void;
}) {
  const [local, setLocal] = useState<string | null>(null);
  const atual = local ?? valor;
  const commit = () => {
    if (local != null && local.trim() !== valor.trim()) onSalvar(local);
    setLocal(null);
  };
  return (
    <div className="inline-flex items-center gap-1">
      <Input
        className="h-8 w-20 text-center"
        inputMode="decimal"
        value={atual}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {local != null && local !== valor && <Save className="h-3.5 w-3.5 text-muted-foreground" />}
    </div>
  );
}
