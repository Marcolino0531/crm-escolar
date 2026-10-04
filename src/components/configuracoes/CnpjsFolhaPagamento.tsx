import { useEffect, useState } from "react";
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
import { cnpjValido, formatarCnpj } from "@/lib/folha-pagamento";
import {
  excluirCnpjFolha,
  listarCnpjsFolha,
  salvarCnpjFolha,
  type CnpjFolha,
} from "@/lib/rh-folha-cnpjs.functions";

type Form = { cnpj: string; empresa: string; observacao: string };
const VAZIO: Form = { cnpj: "", empresa: "", observacao: "" };

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";

// CNPJs (empresas) aceitos na importação do Extrato Mensal do colégio do seletor
// global. O CNPJ do cadastro do colégio é a primeira linha, fixa e somente leitura.
// Vale só para a Folha de Pagamento.
export function CnpjsFolhaPagamento({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { selected, schools } = useSchool();
  const listar = useServerFn(listarCnpjsFolha);
  const salvar = useServerFn(salvarCnpjFolha);
  const excluir = useServerFn(excluirCnpjFolha);

  const escola = selected === "all" ? null : (schools.find((s) => s.id === selected) ?? null);
  const [editando, setEditando] = useState<CnpjFolha | null>(null);
  const [form, setForm] = useState<Form>(VAZIO);

  useEffect(() => {
    setEditando(null);
    setForm(VAZIO);
  }, [selected]);

  const chave = ["rh_folha_cnpjs", escola?.id ?? null];
  const registros = useQuery({
    queryKey: chave,
    enabled: !!escola,
    queryFn: async () => listar({ data: { schoolId: escola!.id } }),
  });

  const limpar = () => {
    setEditando(null);
    setForm(VAZIO);
  };

  const gravar = useMutation({
    mutationFn: async () =>
      salvar({
        data: {
          schoolId: escola!.id,
          id: editando?.id ?? null,
          cnpj: form.cnpj,
          empresa: form.empresa,
          observacao: form.observacao,
        },
      }),
    onSuccess: () => {
      toast.success(editando ? "CNPJ atualizado." : "CNPJ incluído.");
      limpar();
      void qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => excluir({ data: { schoolId: escola!.id, id } }),
    onSuccess: () => {
      toast.success("CNPJ excluído.");
      void qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível excluir."),
  });

  if (!escola) return <SelecioneUnidade acao="O cadastro dos CNPJs da Folha de Pagamento" />;

  const cnpjOk = cnpjValido(form.cnpj);
  const formOk = cnpjOk && form.empresa.trim() !== "";
  const linhas = registros.data ?? [];

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Empresas (CNPJs) de {escola.name} aceitas na importação do Extrato Mensal da Folha de
        Pagamento. O CNPJ do cadastro do colégio já é aceito. Excluir um CNPJ impede novas
        importações dele; as importações já feitas não mudam.
      </p>

      {podeEditar && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-semibold">
            {editando ? "Editar CNPJ" : "Novo CNPJ"} · {escola.name}
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">CNPJ</Label>
              <Input
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={form.cnpj}
                onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))}
                onBlur={() => setForm((f) => ({ ...f, cnpj: formatarCnpj(f.cnpj) }))}
              />
              {form.cnpj.trim() !== "" && !cnpjOk && (
                <p className="text-[11px] text-destructive">CNPJ inválido.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Nome da empresa</Label>
              <Input
                value={form.empresa}
                onChange={(e) => setForm((f) => ({ ...f, empresa: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Observação</Label>
              <Input
                value={form.observacao}
                onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
              />
            </div>
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
              <Button variant="ghost" onClick={limpar}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}

      {registros.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : registros.isError ? (
        <p className="text-sm text-destructive">
          {registros.error instanceof Error ? registros.error.message : "Erro ao carregar."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CNPJ</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Observação</TableHead>
              <TableHead>Incluído</TableHead>
              <TableHead>Editado</TableHead>
              {podeEditar && <TableHead className="w-24 text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((r) => (
              <TableRow key={r.id ?? "principal"} className={r.principal ? "bg-muted/40" : ""}>
                <TableCell className="tabular-nums">
                  {r.cnpj ? formatarCnpj(r.cnpj) : "não cadastrado"}
                </TableCell>
                <TableCell>{r.empresa}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.observacao}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.principal ? "—" : `${r.incluidoPorNome} · ${dataHora(r.incluidoEm)}`}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.editadoEm ? `${r.editadoPorNome ?? ""} · ${dataHora(r.editadoEm)}` : "—"}
                </TableCell>
                {podeEditar && (
                  <TableCell className="text-right">
                    {r.principal || !r.id ? (
                      <span className="text-[11px] text-muted-foreground">Fixo</span>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Editar"
                          onClick={() => {
                            setEditando(r);
                            setForm({
                              cnpj: formatarCnpj(r.cnpj),
                              empresa: r.empresa,
                              observacao: r.observacao,
                            });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Excluir"
                          disabled={remover.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Excluir o CNPJ ${formatarCnpj(r.cnpj)}? Novas importações dele serão recusadas.`,
                              )
                            )
                              remover.mutate(r.id!);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
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
