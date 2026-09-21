// Parecer descritivo do Infantil: texto livre por aluno × trimestre, sem nota.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { selectAll } from "@/lib/supabase-paginate";
import {
  TRIMESTRES,
  parecerDoAluno,
  type ParecerRow,
  type Trimestre,
} from "@/lib/pedagogico-notas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AlunoDaTurma } from "./Avaliacoes";

interface Props {
  schoolId: string;
  ano: number;
  turmaNome: string;
  alunos: AlunoDaTurma[];
  // funcionarios.id do professor que assina o parecer.
  professorId: string | null;
  podeEditar: boolean;
}

type ParecerDb = ParecerRow & { id: string; professor_id: string; lancado_em: string };

export function Pareceres({ schoolId, ano, turmaNome, alunos, professorId, podeEditar }: Props) {
  const qc = useQueryClient();
  const chave = { school_id: schoolId, ano_letivo: ano, turma_nome: turmaNome };
  const queryKey = ["pedagogico_pareceres", schoolId, ano, turmaNome];
  const [trimestre, setTrimestre] = useState<Trimestre>(1);

  const { data: pareceres = [] } = useQuery({
    queryKey,
    queryFn: () =>
      selectAll<ParecerDb>(() =>
        supabase
          .from("pedagogico_pareceres" as never)
          .select(
            "id, school_id, ano_letivo, turma_nome, sponte_aluno_id, professor_id, trimestre, texto, lancado_em",
          )
          .match(chave)
          .order("id"),
      ),
  });

  const salvar = useMutation({
    mutationFn: async (p: { alunoId: string; texto: string }) => {
      if (!professorId) throw new Error("Seu usuário não está vinculado a um funcionário.");
      const existente = pareceres.find(
        (x) => x.sponte_aluno_id === p.alunoId && x.trimestre === trimestre,
      );
      if (!p.texto.trim()) {
        if (!existente) return;
        const { error } = await supabase
          .from("pedagogico_pareceres" as never)
          .delete()
          .eq("id", existente.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("pedagogico_pareceres" as never).upsert(
        {
          ...chave,
          sponte_aluno_id: p.alunoId,
          trimestre,
          texto: p.texto.trim(),
          professor_id: existente?.professor_id ?? professorId,
        } as never,
        { onConflict: "school_id,ano_letivo,turma_nome,sponte_aluno_id,trimestre" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Parecer salvo.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Trimestre</Label>
          <Select
            value={String(trimestre)}
            onValueChange={(v) => setTrimestre(Number(v) as Trimestre)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIMESTRES.map((t) => (
                <SelectItem key={t} value={String(t)}>
                  {t}º trimestre
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant="secondary">
          {pareceres.filter((p) => p.trimestre === trimestre).length} de {alunos.length} parecer(es)
          escritos
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Educação Infantil: acompanhamento por parecer descritivo, sem notas, provas ou recuperação.
      </p>
      {alunos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Turma sem alunos sincronizados.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {alunos.map((a) => (
            <ParecerCard
              key={`${a.sponte_aluno_id}-${trimestre}`}
              aluno={a}
              parecer={
                parecerDoAluno(pareceres, chave, a.sponte_aluno_id, trimestre) as ParecerDb | null
              }
              podeEditar={podeEditar}
              salvando={salvar.isPending}
              onSalvar={(texto) => salvar.mutate({ alunoId: a.sponte_aluno_id, texto })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ParecerCard({
  aluno,
  parecer,
  podeEditar,
  salvando,
  onSalvar,
}: {
  aluno: AlunoDaTurma;
  parecer: ParecerDb | null;
  podeEditar: boolean;
  salvando: boolean;
  onSalvar: (texto: string) => void;
}) {
  const [texto, setTexto] = useState(parecer?.texto ?? "");
  const alterado = texto.trim() !== (parecer?.texto ?? "").trim();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{aluno.aluno_nome}</span>
          {parecer && (
            <span className="text-xs font-normal text-muted-foreground">
              {new Date(parecer.lancado_em).toLocaleDateString("pt-BR")}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          rows={6}
          value={texto}
          disabled={!podeEditar}
          placeholder="Escreva o parecer descritivo do trimestre…"
          onChange={(e) => setTexto(e.target.value)}
        />
        {podeEditar && (
          <div className="flex justify-end">
            <Button size="sm" disabled={!alterado || salvando} onClick={() => onSalvar(texto)}>
              <Save className="mr-1 h-4 w-4" /> Salvar parecer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
