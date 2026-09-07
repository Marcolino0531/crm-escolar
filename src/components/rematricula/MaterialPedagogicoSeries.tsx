import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SelecioneUnidade, useUnidadeAtiva } from "@/components/SelecioneUnidade";
import { filtrarPorUnidade } from "@/lib/unidade-global";
import { parseBRLNumber } from "@/lib/currency";
import {
  formatarBRL,
  opcoesParcelamentoMaterial,
  rotuloItemMaterial,
  rotuloParcelamento,
} from "@/lib/rematricula";
import {
  ROTULO_SEGMENTO_MATRICULA,
  SEGMENTOS_MATRICULA,
  mensagemPendenciasCampanha,
  type SegmentoMatricula,
} from "@/lib/rematricula-matricula";
import {
  alterarCampanhaRematricula,
  anosLetivosDiario,
  excluirMaterialItem,
  excluirMaterialSerie,
  listarCampanhasRematricula,
  listarMaterialItens,
  listarMaterialSeries,
  listarValoresMatricula,
  prepararCampanhaRematricula,
  salvarAnoVigenteDiario,
  salvarMaterialItem,
  salvarMaterialSerie,
  salvarValorMatricula,
  type MaterialItemRegistro,
  type MaterialSerieRegistro,
} from "@/lib/rematricula.functions";

// Campanhas de rematrícula por ano letivo. Cada ano tem a sua linha: o portal
// público /rematricula/{ano} só aceita acesso com a campanha daquele ano aberta,
// e abrir exige o valor da Matrícula cadastrado para todos os segmentos.
function CampanhasRematricula({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const listar = useServerFn(listarCampanhasRematricula);
  const preparar = useServerFn(prepararCampanhaRematricula);
  const alterar = useServerFn(alterarCampanhaRematricula);
  const [novoAno, setNovoAno] = useState("");

  const campanhas = useQuery({
    queryKey: ["rematricula_campanhas"],
    queryFn: async () => listar({ data: undefined }),
  });

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["rematricula_campanhas"] });
    void qc.invalidateQueries({ queryKey: ["rematricula_acompanhamento"] });
    void qc.invalidateQueries({ queryKey: ["diario_anos_letivos"] });
  };

  const criar = useMutation({
    mutationFn: async () => preparar({ data: { anoLetivo: Number(novoAno) } }),
    onSuccess: () => {
      toast.success(`Campanha de ${novoAno} preparada (fechada). Cadastre os valores e abra.`);
      setNovoAno("");
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível preparar."),
  });

  const mudar = useMutation({
    mutationFn: async (args: { anoLetivo: number; aberta: boolean }) => alterar({ data: args }),
    onSuccess: (_r, args) => {
      toast.success(
        args.aberta
          ? `Campanha de ${args.anoLetivo} aberta. O portal /rematricula/${args.anoLetivo} já aceita acessos.`
          : `Campanha de ${args.anoLetivo} fechada. Links desse ano deixam de dar acesso.`,
      );
      invalidar();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.", {
        duration: 10000,
      }),
  });

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Campanhas de Rematrícula</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Uma campanha por ano letivo. O responsável só entra pelo link se a campanha do ano estiver
        aberta; escolhas, links e contratos ficam guardados pelo ano da campanha.
      </p>
      {campanhas.isLoading ? (
        <Skeleton className="mt-3 h-20 w-full" />
      ) : (
        <ul className="mt-3 space-y-2" data-campanhas>
          {(campanhas.data ?? []).map((c) => {
            const pendencia = mensagemPendenciasCampanha(c.anoLetivo, c.pendencias);
            return (
              <li
                key={c.anoLetivo}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">
                    Rematrícula {c.anoLetivo}{" "}
                    <Badge variant={c.aberta ? "default" : "secondary"}>
                      {c.aberta ? "Aberta" : "Fechada"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.atualizadoEm
                      ? `Alterada em ${new Date(c.atualizadoEm).toLocaleDateString("pt-BR")}${
                          c.atualizadoPor ? ` · ${c.atualizadoPor}` : ""
                        }.`
                      : ""}
                  </p>
                  {pendencia && !c.aberta && (
                    <p className="mt-1 text-xs text-amber-700">{pendencia}</p>
                  )}
                </div>
                {podeEditar && (
                  <Button
                    size="sm"
                    variant={c.aberta ? "outline" : "default"}
                    disabled={mudar.isPending || (!c.aberta && pendencia !== null)}
                    onClick={() => mudar.mutate({ anoLetivo: c.anoLetivo, aberta: !c.aberta })}
                  >
                    {mudar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {c.aberta ? "Fechar campanha" : "Abrir campanha"}
                  </Button>
                )}
              </li>
            );
          })}
          {campanhas.data?.length === 0 && (
            <li className="text-xs text-muted-foreground">Nenhuma campanha cadastrada.</li>
          )}
        </ul>
      )}
      {podeEditar && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Novo ano</Label>
            <Input
              className="h-9 w-28"
              inputMode="numeric"
              placeholder={String(new Date().getFullYear() + 1)}
              value={novoAno}
              onChange={(e) => setNovoAno(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <Button
            variant="outline"
            className="gap-2"
            disabled={novoAno.length !== 4 || criar.isPending}
            onClick={() => criar.mutate()}
          >
            {criar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Preparar campanha
          </Button>
        </div>
      )}
    </div>
  );
}

// Valor da Matrícula por segmento e ano letivo (antes fixo no código). O portal
// usa o valor do ano da campanha em que o responsável está; sem valor para o
// segmento do aluno, a campanha do ano não abre.
function ValoresMatricula({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const listar = useServerFn(listarValoresMatricula);
  const salvar = useServerFn(salvarValorMatricula);
  const [ano, setAno] = useState("");
  const [segmento, setSegmento] = useState<SegmentoMatricula>("infantil_fundamental_1");
  const [valor, setValor] = useState("");

  const valores = useQuery({
    queryKey: ["rematricula_matricula_valores"],
    queryFn: async () => listar({ data: undefined }),
  });

  const gravar = useMutation({
    mutationFn: async () =>
      salvar({ data: { anoLetivo: Number(ano), segmento, valor: parseBRLNumber(valor) } }),
    onSuccess: () => {
      toast.success("Valor da Matrícula salvo.");
      setValor("");
      void qc.invalidateQueries({ queryKey: ["rematricula_matricula_valores"] });
      void qc.invalidateQueries({ queryKey: ["rematricula_campanhas"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Valor da Matrícula por segmento e ano</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Valor cobrado na Matrícula (parcelável de setembro a janeiro) conforme a série que o aluno
        vai cursar no ano letivo. Precisa existir para os dois segmentos antes de abrir a campanha.
      </p>
      {valores.isLoading ? (
        <Skeleton className="mt-3 h-20 w-full" />
      ) : (
        <div className="mt-3 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ano letivo</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Atualizado</TableHead>
                {podeEditar && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(valores.data ?? []).map((v) => (
                <TableRow key={`${v.anoLetivo}-${v.segmento}`}>
                  <TableCell>{v.anoLetivo}</TableCell>
                  <TableCell>{ROTULO_SEGMENTO_MATRICULA[v.segmento]}</TableCell>
                  <TableCell className="text-right">{formatarBRL(v.valor)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(v.atualizadoEm).toLocaleDateString("pt-BR")}
                    {v.atualizadoPor ? ` · ${v.atualizadoPor}` : ""}
                  </TableCell>
                  {podeEditar && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Editar"
                        onClick={() => {
                          setAno(String(v.anoLetivo));
                          setSegmento(v.segmento);
                          setValor(v.valor.toFixed(2).replace(".", ","));
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {valores.data?.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={podeEditar ? 5 : 4}
                    className="text-center text-muted-foreground"
                  >
                    Nenhum valor cadastrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {podeEditar && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Ano letivo</Label>
            <Input
              className="h-9 w-28"
              inputMode="numeric"
              placeholder={String(new Date().getFullYear() + 1)}
              value={ano}
              onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Segmento</Label>
            <Select value={segmento} onValueChange={(v) => setSegmento(v as SegmentoMatricula)}>
              <SelectTrigger className="h-9 w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEGMENTOS_MATRICULA.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ROTULO_SEGMENTO_MATRICULA[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Valor (R$)</Label>
            <Input
              className="h-9 w-36"
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <Button
            className="gap-2"
            disabled={ano.length !== 4 || !valor.trim() || gravar.isPending}
            onClick={() => gravar.mutate()}
          >
            {gravar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar valor
          </Button>
        </div>
      )}
    </div>
  );
}

// Ano vigente do Diário do Aluno: configuração administrativa única, separada
// das campanhas de rematrícula.
function AnoVigenteDiario({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const obter = useServerFn(anosLetivosDiario);
  const salvarVigente = useServerFn(salvarAnoVigenteDiario);
  const [anoVigente, setAnoVigente] = useState("");

  const config = useQuery({
    queryKey: ["diario_anos_letivos"],
    queryFn: async () => obter({ data: undefined }),
  });

  const gravarVigente = useMutation({
    mutationFn: async () => salvarVigente({ data: { anoVigente: Number(anoVigente) } }),
    onSuccess: () => {
      toast.success("Ano vigente atualizado. O Diário do Aluno passa a abrir nesse ano.");
      setAnoVigente("");
      void qc.invalidateQueries({ queryKey: ["diario_anos_letivos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const vigente = config.data?.anoVigente ?? null;
  const rematricula = config.data?.anoRematricula ?? null;

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Ano Vigente (Diário do Aluno)</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {vigente
          ? `O Diário do Aluno abre e registra refeições/entrada-saída pelo plano de ${vigente}. A rotina preenchida na rematrícula fica guardada no ano da campanha${rematricula ? ` (${rematricula})` : ""} sem mexer no ano vigente.`
          : "Carregando…"}
      </p>
      {podeEditar && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Ano</Label>
            <Input
              className="h-9 w-28"
              inputMode="numeric"
              placeholder={vigente ? String(vigente + 1) : ""}
              value={anoVigente}
              onChange={(e) => setAnoVigente(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <Button
            variant="outline"
            className="gap-2"
            disabled={anoVigente.length !== 4 || gravarVigente.isPending}
            onClick={() => gravarVigente.mutate()}
          >
            {gravarVigente.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Trocar ano vigente
          </Button>
        </div>
      )}
    </div>
  );
}

// Itens inclusos no material de uma unidade × ano × série (nome + volumes).
// É esta lista que o portal e o contrato exibem; sem cadastro, nada aparece.
function ItensMaterialSerie({
  podeEditar,
  unidade,
  anoLetivo,
  serie,
  itens,
}: {
  podeEditar: boolean;
  unidade: string;
  anoLetivo: number;
  serie: string;
  itens: MaterialItemRegistro[];
}) {
  const qc = useQueryClient();
  const salvar = useServerFn(salvarMaterialItem);
  const excluir = useServerFn(excluirMaterialItem);
  const [editando, setEditando] = useState<MaterialItemRegistro | null>(null);
  const [nome, setNome] = useState("");
  const [quantidade, setQuantidade] = useState("1");

  function limpar() {
    setEditando(null);
    setNome("");
    setQuantidade("1");
  }

  const invalidar = () => void qc.invalidateQueries({ queryKey: ["material_pedagogico_itens"] });

  const gravar = useMutation({
    mutationFn: async () =>
      salvar({
        data: {
          id: editando?.id ?? null,
          unidade,
          anoLetivo,
          serie,
          nome: nome.trim(),
          quantidade: Number(quantidade),
        },
      }),
    onSuccess: () => {
      toast.success(editando ? "Item atualizado." : "Item adicionado.");
      limpar();
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => excluir({ data: { id } }),
    onSuccess: () => {
      toast.success("Item removido.");
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  const qtd = Number(quantidade);
  const formOk = nome.trim().length > 0 && Number.isInteger(qtd) && qtd > 0;

  return (
    <div className="rounded-md border bg-muted/20 p-3" data-itens-material>
      <p className="text-xs font-medium">
        Itens inclusos — {serie} · {anoLetivo}
      </p>
      {itens.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Nenhum item cadastrado. O portal e o contrato não listam itens para esta série.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {itens.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{rotuloItemMaterial({ nome: i.nome, quantidade: i.quantidade })}</span>
              {podeEditar && (
                <span className="flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar item"
                    onClick={() => {
                      setEditando(i);
                      setNome(i.nome);
                      setQuantidade(String(i.quantidade));
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remover item"
                    disabled={remover.isPending}
                    onClick={() => remover.mutate(i.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {podeEditar && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Item</Label>
            <Input
              className="h-9 w-64"
              placeholder="Ex.: Coleção Principal (Bernoulli)"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Volumes</Label>
            <Input
              className="h-9 w-20"
              inputMode="numeric"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, "").slice(0, 3))}
            />
          </div>
          <Button size="sm" disabled={!formOk || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {editando ? "Salvar item" : "Adicionar item"}
          </Button>
          {editando && (
            <Button size="sm" variant="ghost" onClick={limpar}>
              Cancelar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Valor anual do material pedagógico por unidade + ano letivo + série, com a lista
// de itens inclusos. É o valor que o portal público de Rematrícula do ano oferece
// ao responsável para parcelar em até 8x — cada unidade e cada ano têm o seu.
export function MaterialPedagogicoSeries({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const listar = useServerFn(listarMaterialSeries);
  const listarItens = useServerFn(listarMaterialItens);
  const salvar = useServerFn(salvarMaterialSerie);
  const excluir = useServerFn(excluirMaterialSerie);

  const [editando, setEditando] = useState<MaterialSerieRegistro | null>(null);
  // Unidade do seletor global do topo: a tela não tem seletor próprio, e o
  // cadastro grava sempre na unidade que está no topo.
  const unidade = useUnidadeAtiva();
  const [ano, setAno] = useState(String(new Date().getFullYear() + 1));
  const [serie, setSerie] = useState("");
  const [valor, setValor] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);

  const registros = useQuery({
    queryKey: ["material_pedagogico_series"],
    queryFn: async () => listar({ data: undefined }),
  });
  const itens = useQuery({
    queryKey: ["material_pedagogico_itens"],
    queryFn: async () => listarItens({ data: undefined }),
  });

  function limpar() {
    setEditando(null);
    setSerie("");
    setValor("");
  }

  // Trocar a unidade no topo cancela a edição de um registro da unidade anterior.
  useEffect(() => {
    setEditando(null);
    setSerie("");
    setValor("");
    setAberta(null);
  }, [unidade]);

  const gravar = useMutation({
    mutationFn: async () =>
      salvar({
        data: {
          id: editando?.id ?? null,
          unidade: unidade ?? "",
          anoLetivo: Number(ano),
          serie: serie.trim(),
          valorAnual: parseBRLNumber(valor),
        },
      }),
    onSuccess: () => {
      toast.success("Valor do material salvo.");
      limpar();
      void qc.invalidateQueries({ queryKey: ["material_pedagogico_series"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => excluir({ data: { id } }),
    onSuccess: () => {
      toast.success("Valor removido.");
      void qc.invalidateQueries({ queryKey: ["material_pedagogico_series"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  const valorNumero = parseBRLNumber(valor);
  const formOk = !!unidade && ano.length === 4 && serie.trim().length > 0 && valorNumero > 0;
  const previa = formOk ? opcoesParcelamentoMaterial(valorNumero) : [];
  const linhas = filtrarPorUnidade(registros.data ?? [], unidade, (r) => r.unidade);
  const todosItens = itens.data ?? [];

  return (
    <div className="space-y-6">
      <CampanhasRematricula podeEditar={podeEditar} />
      <ValoresMatricula podeEditar={podeEditar} />
      <AnoVigenteDiario podeEditar={podeEditar} />
      {podeEditar && !unidade && <SelecioneUnidade acao="O cadastro do material pedagógico" />}
      {podeEditar && unidade && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-semibold">
            {editando ? "Editar valor do material" : "Novo valor do material"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Unidade</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {unidade}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Ano letivo</Label>
              <Input
                inputMode="numeric"
                value={ano}
                onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Série</Label>
              <Input
                placeholder="Ex.: Maternal 3, 1º Ano"
                value={serie}
                onChange={(e) => setSerie(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Valor anual</Label>
              <Input
                inputMode="decimal"
                placeholder="R$ 0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
          </div>

          {previa.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Parcelamento oferecido ao responsável: {previa.map(rotuloParcelamento).join(" · ")}
            </p>
          )}

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
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unidade</TableHead>
              <TableHead>Ano</TableHead>
              <TableHead>Série</TableHead>
              <TableHead className="text-right">Valor anual</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead>Atualizado por</TableHead>
              {podeEditar && <TableHead className="w-24 text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={podeEditar ? 7 : 6} className="text-sm text-muted-foreground">
                  Nenhum valor cadastrado. Sem cadastro, o portal de Rematrícula não oferece o
                  material para a série.
                </TableCell>
              </TableRow>
            )}
            {linhas.map((r) => {
              const itensDaSerie = todosItens.filter(
                (i) =>
                  i.unidade === r.unidade &&
                  i.anoLetivo === r.anoLetivo &&
                  i.serieChave === r.serieChave,
              );
              const expandida = aberta === r.id;
              return (
                <Fragment key={r.id}>
                  <TableRow>
                    <TableCell>{r.unidade}</TableCell>
                    <TableCell>{r.anoLetivo}</TableCell>
                    <TableCell>{r.serie}</TableCell>
                    <TableCell className="text-right">{formatarBRL(r.valorAnual)}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => setAberta(expandida ? null : r.id)}
                      >
                        {expandida ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {itensDaSerie.length} {itensDaSerie.length === 1 ? "item" : "itens"}
                      </Button>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.atualizadoPor}
                    </TableCell>
                    {podeEditar && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Editar valor"
                          onClick={() => {
                            setEditando(r);
                            setAno(String(r.anoLetivo));
                            setSerie(r.serie);
                            setValor(r.valorAnual.toFixed(2).replace(".", ","));
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remover valor"
                          disabled={remover.isPending}
                          onClick={() => remover.mutate(r.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                  {expandida && (
                    <TableRow>
                      <TableCell colSpan={podeEditar ? 7 : 6} className="p-2">
                        <ItensMaterialSerie
                          podeEditar={podeEditar}
                          unidade={r.unidade}
                          anoLetivo={r.anoLetivo}
                          serie={r.serie}
                          itens={itensDaSerie}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
