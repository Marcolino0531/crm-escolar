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
import {
  COLONIA_VALORES_PADRAO,
  MESES_ROTULO,
  type ColoniaValoresRegistro,
} from "@/lib/colonia-valores";
import {
  excluirValoresColonia,
  listarValoresColonia,
  salvarValoresColonia,
} from "@/lib/colonia-valores.functions";
import { formatarBRL } from "@/lib/rematricula";

const brl = (n: number) => n.toFixed(2).replace(".", ",");

type Form = {
  ano: string;
  diariaAvulsa: string;
  pacoteSemanal: string;
  horaExtraPorHora: string;
  lanchePorRegistro: string;
  refeicaoPrincipalPorRegistro: string;
  franquiaMinutos: string;
  diasParaPacote: string;
  meses: number[];
};

function formPadrao(): Form {
  const p = COLONIA_VALORES_PADRAO;
  return {
    ano: String(new Date().getFullYear() + 1),
    diariaAvulsa: brl(p.diariaAvulsa),
    pacoteSemanal: brl(p.pacoteSemanal),
    horaExtraPorHora: brl(p.horaExtraPorHora),
    lanchePorRegistro: brl(p.lanchePorRegistro),
    refeicaoPrincipalPorRegistro: brl(p.refeicaoPrincipalPorRegistro),
    franquiaMinutos: String(p.franquiaMinutos),
    diasParaPacote: String(p.diasParaPacote),
    meses: [...p.mesesCreditoIsencao],
  };
}

function formDe(r: ColoniaValoresRegistro): Form {
  return {
    ano: String(r.anoLetivo),
    diariaAvulsa: brl(r.diariaAvulsa),
    pacoteSemanal: brl(r.pacoteSemanal),
    horaExtraPorHora: brl(r.horaExtraPorHora),
    lanchePorRegistro: brl(r.lanchePorRegistro),
    refeicaoPrincipalPorRegistro: brl(r.refeicaoPrincipalPorRegistro),
    franquiaMinutos: String(r.franquiaMinutos),
    diasParaPacote: String(r.diasParaPacote),
    meses: [...r.mesesCreditoIsencao],
  };
}

const MESES = Array.from({ length: 12 }, (_, i) => i + 1);

// Valores e regras da Colônia de Férias por unidade × ano letivo. Sem cadastro
// para a unidade/ano, o Fechamento Semanal usa os valores padrão e avisa.
export function ValoresColonia({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { selected, schools } = useSchool();
  const listar = useServerFn(listarValoresColonia);
  const salvar = useServerFn(salvarValoresColonia);
  const excluir = useServerFn(excluirValoresColonia);

  const escola = selected === "all" ? null : (schools.find((s) => s.id === selected) ?? null);
  const [editando, setEditando] = useState<ColoniaValoresRegistro | null>(null);
  const [form, setForm] = useState<Form>(formPadrao);

  useEffect(() => {
    setEditando(null);
    setForm(formPadrao());
  }, [selected]);

  const registros = useQuery({
    queryKey: ["colonia_valores"],
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
          diariaAvulsa: parseBRLNumber(form.diariaAvulsa),
          pacoteSemanal: parseBRLNumber(form.pacoteSemanal),
          horaExtraPorHora: parseBRLNumber(form.horaExtraPorHora),
          lanchePorRegistro: parseBRLNumber(form.lanchePorRegistro),
          refeicaoPrincipalPorRegistro: parseBRLNumber(form.refeicaoPrincipalPorRegistro),
          franquiaMinutos: Number(form.franquiaMinutos),
          diasParaPacote: Number(form.diasParaPacote),
          mesesCreditoIsencao: form.meses,
        },
      }),
    onSuccess: () => {
      toast.success("Valores da Colônia salvos.");
      setEditando(null);
      setForm(formPadrao());
      void qc.invalidateQueries({ queryKey: ["colonia_valores"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => excluir({ data: { id } }),
    onSuccess: () => {
      toast.success("Cadastro removido.");
      void qc.invalidateQueries({ queryKey: ["colonia_valores"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  const formOk = !!escola && form.ano.length === 4 && form.franquiaMinutos !== "";
  const linhas = (registros.data ?? []).filter((r) => !escola || r.schoolId === escola.id);
  const p = COLONIA_VALORES_PADRAO;

  const campo = (rotulo: string, k: keyof Form, mode: "decimal" | "numeric" = "decimal") => (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{rotulo}</Label>
      <Input inputMode={mode} value={form[k] as string} onChange={set(k)} />
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Sem cadastro para a unidade/ano, o Fechamento Semanal usa os valores padrão: diária{" "}
        {formatarBRL(p.diariaAvulsa)}, pacote {formatarBRL(p.pacoteSemanal)} ({p.diasParaPacote}{" "}
        dias), hora extra {formatarBRL(p.horaExtraPorHora)}, lanche{" "}
        {formatarBRL(p.lanchePorRegistro)}, refeição principal{" "}
        {formatarBRL(p.refeicaoPrincipalPorRegistro)}, franquia {p.franquiaMinutos} min,
        crédito/isenção do Sponte em {p.mesesCreditoIsencao.map((m) => MESES_ROTULO[m]).join(" e ")}
        .
      </p>

      {podeEditar && !escola && <SelecioneUnidade acao="O cadastro dos valores da Colônia" />}
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
            {campo("Diária avulsa (R$)", "diariaAvulsa")}
            {campo("Pacote semanal (R$)", "pacoteSemanal")}
            {campo("Hora extra por hora (R$)", "horaExtraPorHora")}
            {campo("Lanche por registro (R$)", "lanchePorRegistro")}
            {campo("Refeição principal por registro (R$)", "refeicaoPrincipalPorRegistro")}
            {campo("Franquia diária (minutos)", "franquiaMinutos", "numeric")}
            {campo("Dias para virar pacote", "diasParaPacote", "numeric")}
          </div>
          <div className="mt-3 space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              Meses com crédito/isenção do Sponte
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {MESES.map((m) => {
                const on = form.meses.includes(m);
                return (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        meses: on
                          ? f.meses.filter((x) => x !== m)
                          : [...f.meses, m].sort((a, b) => a - b),
                      }))
                    }
                  >
                    {MESES_ROTULO[m]}
                  </Button>
                );
              })}
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
              <TableHead className="text-right">Diária</TableHead>
              <TableHead className="text-right">Pacote</TableHead>
              <TableHead className="text-right">Hora extra</TableHead>
              <TableHead className="text-right">Lanche</TableHead>
              <TableHead className="text-right">Refeição</TableHead>
              <TableHead className="text-right">Franquia</TableHead>
              <TableHead className="text-right">Dias pacote</TableHead>
              <TableHead>Meses Sponte</TableHead>
              <TableHead>Atualizado por</TableHead>
              {podeEditar && <TableHead className="w-24 text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={podeEditar ? 12 : 11} className="text-sm text-muted-foreground">
                  Nenhum cadastro. O Fechamento Semanal usa os valores padrão e avisa.
                </TableCell>
              </TableRow>
            )}
            {linhas.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.unidade}</TableCell>
                <TableCell>{r.anoLetivo}</TableCell>
                <TableCell className="text-right">{formatarBRL(r.diariaAvulsa)}</TableCell>
                <TableCell className="text-right">{formatarBRL(r.pacoteSemanal)}</TableCell>
                <TableCell className="text-right">{formatarBRL(r.horaExtraPorHora)}</TableCell>
                <TableCell className="text-right">{formatarBRL(r.lanchePorRegistro)}</TableCell>
                <TableCell className="text-right">
                  {formatarBRL(r.refeicaoPrincipalPorRegistro)}
                </TableCell>
                <TableCell className="text-right">{r.franquiaMinutos} min</TableCell>
                <TableCell className="text-right">{r.diasParaPacote}</TableCell>
                <TableCell className="text-xs">
                  {r.mesesCreditoIsencao.length === 0
                    ? "—"
                    : r.mesesCreditoIsencao.map((m) => MESES_ROTULO[m]).join(", ")}
                </TableCell>
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
