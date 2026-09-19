import { useEffect, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SelecioneUnidade } from "@/components/SelecioneUnidade";
import { useSchool } from "@/lib/app-context";
import { parseBRLNumber } from "@/lib/currency";
import { BIBLIOTECA_VALORES_PADRAO, type BibliotecaValoresRegistro } from "@/lib/biblioteca";
import {
  excluirValoresBiblioteca,
  listarValoresBiblioteca,
  salvarValoresBiblioteca,
} from "@/lib/biblioteca-valores.functions";
import { formatarBRL } from "@/lib/rematricula";

const brl = (n: number) => n.toFixed(2).replace(".", ",");

type Form = { ano: string; multaPorDiaUtil: string; multaTeto: string; prazoPadraoDias: string };

function formPadrao(): Form {
  const p = BIBLIOTECA_VALORES_PADRAO;
  return {
    ano: String(new Date().getFullYear() + 1),
    multaPorDiaUtil: brl(p.multaPorDiaUtil),
    multaTeto: brl(p.multaTeto),
    prazoPadraoDias: String(p.prazoPadraoDias),
  };
}

function formDe(r: BibliotecaValoresRegistro): Form {
  return {
    ano: String(r.anoLetivo),
    multaPorDiaUtil: brl(r.multaPorDiaUtil),
    multaTeto: brl(r.multaTeto),
    prazoPadraoDias: String(r.prazoPadraoDias),
  };
}

// Multa por dia útil, teto e prazo padrão da Biblioteca por unidade × ano
// letivo. Sem cadastro para a unidade/ano, a Biblioteca usa os valores padrão.
export function ValoresBiblioteca({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { selected, schools } = useSchool();
  const listar = useServerFn(listarValoresBiblioteca);
  const salvar = useServerFn(salvarValoresBiblioteca);
  const excluir = useServerFn(excluirValoresBiblioteca);

  const escola = selected === "all" ? null : (schools.find((s) => s.id === selected) ?? null);
  const [editando, setEditando] = useState<BibliotecaValoresRegistro | null>(null);
  const [form, setForm] = useState<Form>(formPadrao);

  useEffect(() => {
    setEditando(null);
    setForm(formPadrao());
  }, [selected]);

  const registros = useQuery({
    queryKey: ["biblioteca_valores"],
    queryFn: async () => listar({ data: undefined }),
  });

  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const gravar = useMutation({
    mutationFn: async () =>
      salvar({
        data: {
          schoolId: escola!.id,
          anoLetivo: Number(form.ano),
          multaPorDiaUtil: parseBRLNumber(form.multaPorDiaUtil),
          multaTeto: parseBRLNumber(form.multaTeto),
          prazoPadraoDias: Number(form.prazoPadraoDias),
        },
      }),
    onSuccess: () => {
      toast.success("Valores da Biblioteca salvos.");
      setEditando(null);
      setForm(formPadrao());
      void qc.invalidateQueries({ queryKey: ["biblioteca_valores"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => excluir({ data: { id } }),
    onSuccess: () => {
      toast.success("Cadastro removido.");
      void qc.invalidateQueries({ queryKey: ["biblioteca_valores"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  const formOk = !!escola && form.ano.length === 4 && form.prazoPadraoDias !== "";
  const linhas = (registros.data ?? []).filter((r) => !escola || r.schoolId === escola.id);
  const p = BIBLIOTECA_VALORES_PADRAO;

  const campo = (rotulo: string, k: keyof Form, mode: "decimal" | "numeric" = "decimal") => (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{rotulo}</Label>
      <Input inputMode={mode} value={form[k]} onChange={set(k)} />
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Sem cadastro para a unidade/ano, a Biblioteca usa os valores padrão: multa de{" "}
        {formatarBRL(p.multaPorDiaUtil)} por dia útil de atraso, teto de {formatarBRL(p.multaTeto)}{" "}
        por empréstimo e prazo de devolução de {p.prazoPadraoDias} dias. O ano considerado é o da
        data do empréstimo.
      </p>

      {podeEditar && !escola && <SelecioneUnidade acao="O cadastro dos valores da Biblioteca" />}
      {podeEditar && escola && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-semibold">
            {editando ? "Editar valores" : "Novo cadastro"} · {escola.name}
          </h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Ano letivo</Label>
              <Input
                inputMode="numeric"
                value={form.ano}
                disabled={!!editando}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ano: e.target.value.replace(/\D/g, "").slice(0, 4) }))
                }
              />
            </div>
            {campo("Multa por dia útil (R$)", "multaPorDiaUtil")}
            {campo("Teto da multa por empréstimo (R$)", "multaTeto")}
            {campo("Prazo padrão de devolução (dias)", "prazoPadraoDias", "numeric")}
          </div>
          <div className="mt-4 flex gap-2">
            <Button disabled={!formOk || gravar.isPending} onClick={() => gravar.mutate()}>
              {gravar.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {editando ? "Salvar alterações" : "Adicionar"}
            </Button>
            {editando && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditando(null);
                  setForm(formPadrao());
                }}
              >
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}

      {registros.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unidade</TableHead>
              <TableHead>Ano</TableHead>
              <TableHead className="text-right">Multa/dia útil</TableHead>
              <TableHead className="text-right">Teto</TableHead>
              <TableHead className="text-right">Prazo</TableHead>
              <TableHead>Atualizado por</TableHead>
              {podeEditar && <TableHead className="w-24 text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={podeEditar ? 7 : 6} className="text-sm text-muted-foreground">
                  Nenhum cadastro. A Biblioteca usa os valores padrão.
                </TableCell>
              </TableRow>
            )}
            {linhas.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.unidade}</TableCell>
                <TableCell>{r.anoLetivo}</TableCell>
                <TableCell className="text-right">{formatarBRL(r.multaPorDiaUtil)}</TableCell>
                <TableCell className="text-right">{formatarBRL(r.multaTeto)}</TableCell>
                <TableCell className="text-right">{r.prazoPadraoDias} dias</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.atualizadoPor}</TableCell>
                {podeEditar && (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar"
                      disabled={!escola || escola.id !== r.schoolId}
                      onClick={() => {
                        setEditando(r);
                        setForm(formDe(r));
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover"
                      disabled={remover.isPending}
                      onClick={() => remover.mutate(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
