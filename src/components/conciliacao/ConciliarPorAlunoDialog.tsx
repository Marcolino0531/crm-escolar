import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, Search, User, X } from "lucide-react";
import {
  buscarAlunosSponte,
  fetchTitulosAlunoSponte,
  type AlunoBuscaSponte,
  type TituloSponteAluno,
} from "@/lib/sponte.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { formatBRLInput, parseBRLNumber } from "@/lib/currency";

// Item do rateio que o operador montou escolhendo títulos do aluno no Sponte.
export interface ItemConciliacaoAluno {
  categoria: string;
  valor: number;
  contaReceberId: string;
  numeroBoleto: string;
  vencimento: string; // YYYY-MM-DD
}

export interface TransacaoParaConciliar {
  id: string;
  date: string;
  description: string | null;
  amount: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unidade: string;
  transacao: TransacaoParaConciliar | null;
  salvando: boolean;
  onConfirmar: (aluno: AlunoBuscaSponte, itens: ItemConciliacaoAluno[]) => Promise<void>;
}

type FiltroTitulos = "todos" | "aberto" | "quitado";

interface GrupoTitulos {
  chave: string;
  numeroBoleto: string;
  vencimento: string;
  dataPagamento: string;
  quitado: boolean;
  total: number;
  linhas: TituloSponteAluno[];
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatBR(date: string): string {
  const [y, m, d] = date.split("-");
  return d && m && y ? `${d}/${m}/${y}` : date;
}

function fechaCentavos(a: number, b: number, tolCentavos = 2): boolean {
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= tolCentavos;
}

function chaveLinha(t: TituloSponteAluno): string {
  return `${t.contaReceberID}|${t.numeroParcela}|${t.vencimento}|${t.categoria}`;
}

// Valor de referência da parcela: o efetivamente pago quando quitada; o saldo em
// aberto caso contrário (é o que o operador espera ver bater com o extrato).
function valorReferencia(t: TituloSponteAluno): number {
  if (t.quitada && t.valorPago > 0) return t.valorPago;
  return t.saldo > 0 ? t.saldo : t.valor;
}

function agruparPorBoleto(titulos: TituloSponteAluno[]): GrupoTitulos[] {
  const grupos = new Map<string, GrupoTitulos>();
  for (const t of titulos) {
    const chave =
      t.numeroBoleto && t.numeroBoleto !== "0" ? `bol_${t.numeroBoleto}` : `venc_${t.vencimento}`;
    const atual = grupos.get(chave);
    if (atual) {
      atual.linhas.push(t);
      atual.total += valorReferencia(t);
      atual.quitado = atual.quitado && t.quitada;
      if (!atual.dataPagamento) atual.dataPagamento = t.dataPagamento;
    } else {
      grupos.set(chave, {
        chave,
        numeroBoleto: t.numeroBoleto,
        vencimento: t.vencimento,
        dataPagamento: t.dataPagamento,
        quitado: t.quitada,
        total: valorReferencia(t),
        linhas: [t],
      });
    }
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
    .sort((a, b) => b.vencimento.localeCompare(a.vencimento));
}

export function ConciliarPorAlunoDialog({
  open,
  onOpenChange,
  unidade,
  transacao,
  salvando,
  onConfirmar,
}: Props) {
  const buscarAlunos = useServerFn(buscarAlunosSponte);
  const fetchTitulos = useServerFn(fetchTitulosAlunoSponte);

  const [termo, setTermo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [aluno, setAluno] = useState<AlunoBuscaSponte | null>(null);
  const [filtro, setFiltro] = useState<FiltroTitulos>("todos");
  // Chave da parcela → valor (texto editável, para juros/multa/desconto).
  const [selecionadas, setSelecionadas] = useState<Record<string, string>>({});

  // Cada abertura começa limpa: a conciliação é sempre de UMA linha do extrato.
  useEffect(() => {
    if (!open) return;
    setTermo("");
    setResultados(null);
    setTruncado(false);
    setAluno(null);
    setFiltro("todos");
    setSelecionadas({});
  }, [open, transacao?.id]);

  const { data: titulosResult, isFetching: titulosCarregando } = useQuery({
    queryKey: ["titulos-aluno-sponte", unidade, aluno?.alunoId],
    enabled: open && !!aluno,
    queryFn: async () => {
      const r = await fetchTitulos({ data: { alunoId: aluno!.alunoId, unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      return r.titulos;
    },
  });

  const grupos = useMemo(() => {
    const titulos = titulosResult ?? [];
    const filtrados = titulos.filter((t) =>
      filtro === "todos" ? true : filtro === "quitado" ? t.quitada : !t.quitada,
    );
    return agruparPorBoleto(filtrados);
  }, [titulosResult, filtro]);

  const esperado = Number(transacao?.amount ?? 0);
  const soma = useMemo(() => {
    const total = Object.values(selecionadas).reduce((s, v) => {
      const n = parseBRLNumber(v);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    return Math.round(total * 100) / 100;
  }, [selecionadas]);

  const linhasPorChave = useMemo(() => {
    const map = new Map<string, TituloSponteAluno>();
    for (const t of titulosResult ?? []) map.set(chaveLinha(t), t);
    return map;
  }, [titulosResult]);

  const algumEmAberto = Object.keys(selecionadas).some(
    (k) => linhasPorChave.get(k)?.quitada === false,
  );
  const qtdSelecionadas = Object.keys(selecionadas).length;
  const bate = fechaCentavos(soma, esperado);
  const diferenca = Math.round((esperado - soma) * 100) / 100;

  async function handleBuscar() {
    const t = termo.trim();
    if (t.length < 3) {
      toast.error("Digite ao menos 3 letras do nome do aluno.");
      return;
    }
    setBuscando(true);
    try {
      const r = await buscarAlunos({ data: { nome: t, unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      setResultados(r.alunos);
      setTruncado(r.truncado);
      setAluno(null);
      setSelecionadas({});
      if (r.alunos.length === 0) toast.info("Nenhum aluno encontrado com esse nome nesta unidade.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
    } finally {
      setBuscando(false);
    }
  }

  function alternarLinha(t: TituloSponteAluno, marcar: boolean) {
    const chave = chaveLinha(t);
    setSelecionadas((atual) => {
      const proximo = { ...atual };
      if (marcar) proximo[chave] = formatBRLInput(valorReferencia(t));
      else delete proximo[chave];
      return proximo;
    });
  }

  function alternarGrupo(g: GrupoTitulos, marcar: boolean) {
    setSelecionadas((atual) => {
      const proximo = { ...atual };
      for (const t of g.linhas) {
        const chave = chaveLinha(t);
        if (marcar) proximo[chave] = formatBRLInput(valorReferencia(t));
        else delete proximo[chave];
      }
      return proximo;
    });
  }

  async function handleConfirmar() {
    if (!aluno) return;
    const itens: ItemConciliacaoAluno[] = [];
    for (const [chave, texto] of Object.entries(selecionadas)) {
      const linha = linhasPorChave.get(chave);
      if (!linha) continue;
      const valor = parseBRLNumber(texto);
      if (!Number.isFinite(valor) || valor <= 0) continue;
      itens.push({
        categoria: linha.categoria,
        valor: Math.round(valor * 100) / 100,
        contaReceberId: linha.contaReceberID,
        numeroBoleto: linha.numeroBoleto,
        vencimento: linha.vencimento,
      });
    }
    if (itens.length === 0) {
      toast.error("Selecione ao menos um título com valor maior que zero.");
      return;
    }
    await onConfirmar(aluno, itens);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Conciliar por Aluno</DialogTitle>
        </DialogHeader>

        {transacao && (
          <div className="space-y-3">
            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="truncate">
                <strong>{transacao.description}</strong> · {formatBR(transacao.date)}
              </div>
              <div className="mt-1">
                Valor a conciliar: <strong className="font-mono">{formatBRL(esperado)}</strong>
              </div>
            </div>

            <div>
              <Label className="text-xs">Nome do aluno</Label>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Ex.: Davi Brum"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleBuscar();
                  }}
                />
                <Button onClick={handleBuscar} disabled={buscando}>
                  {buscando ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Search className="h-3 w-3" />
                  )}
                  Buscar
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                A busca consulta o Sponte da unidade <strong>{unidade}</strong> e aceita parte do
                nome (ex.: só o sobrenome da família).
              </p>
            </div>

            {/* Resultados da busca — some assim que um aluno é escolhido. */}
            {!aluno && resultados && resultados.length > 0 && (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1">
                {resultados.map((a) => (
                  <button
                    key={a.alunoId}
                    type="button"
                    className="w-full rounded-md p-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setAluno(a);
                      setSelecionadas({});
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{a.nome}</span>
                      <Badge
                        variant="outline"
                        className={
                          a.situacao === "Ativo"
                            ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                            : "text-muted-foreground"
                        }
                      >
                        {a.situacao || "—"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Sponte {a.alunoId}
                      {a.cpf ? ` · CPF ${a.cpf}` : ""}
                      {a.turma ? ` · ${a.turma}` : ""}
                    </div>
                    {a.responsaveis.length > 0 && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {a.responsaveis
                          .map(
                            (r) =>
                              `${r.nome} (${r.parentesco || "Responsável"}${r.financeiro ? ", financeiro" : ""})`,
                          )
                          .join(" · ")}
                      </div>
                    )}
                  </button>
                ))}
                {truncado && (
                  <p className="p-2 text-xs text-muted-foreground">
                    Mostrando os primeiros resultados — refine o nome para ver os demais.
                  </p>
                )}
              </div>
            )}

            {/* Aluno escolhido + títulos do Sponte. */}
            {aluno && (
              <>
                <div className="flex items-start justify-between gap-2 rounded-md border p-2">
                  <div className="text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <User className="h-3 w-3" /> {aluno.nome}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Sponte {aluno.alunoId}
                      {aluno.turma ? ` · ${aluno.turma}` : ""}
                    </div>
                    {aluno.responsaveis.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {aluno.responsaveis
                          .map(
                            (r) =>
                              `${r.nome} (${r.parentesco || "Responsável"}${r.financeiro ? ", financeiro" : ""})`,
                          )
                          .join(" · ")}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAluno(null);
                      setSelecionadas({});
                    }}
                  >
                    <X className="h-3 w-3" /> Trocar
                  </Button>
                </div>

                <div className="flex items-center gap-1">
                  {(
                    [
                      ["todos", "Todos"],
                      ["aberto", "Em aberto"],
                      ["quitado", "Baixados"],
                    ] as [FiltroTitulos, string][]
                  ).map(([valor, rotulo]) => (
                    <Button
                      key={valor}
                      size="sm"
                      variant={filtro === valor ? "default" : "outline"}
                      onClick={() => setFiltro(valor)}
                    >
                      {rotulo}
                    </Button>
                  ))}
                </div>

                {titulosCarregando ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Consultando os títulos no Sponte…
                  </p>
                ) : grupos.length === 0 ? (
                  <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Nenhum título deste aluno no filtro selecionado.
                  </p>
                ) : (
                  <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                    {grupos.map((g) => {
                      const todasMarcadas = g.linhas.every((t) => chaveLinha(t) in selecionadas);
                      // Destaca o título cujo total bate com a linha do extrato:
                      // é quase sempre o que o operador está procurando.
                      const casaValor = fechaCentavos(g.total, esperado);
                      return (
                        <div
                          key={g.chave}
                          className={`rounded-md border p-2 ${casaValor ? "border-emerald-500/50 bg-emerald-500/5" : ""}`}
                        >
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={todasMarcadas}
                              onCheckedChange={(c) => alternarGrupo(g, c === true)}
                            />
                            <div className="min-w-0 flex-1 text-sm">
                              <span className="font-medium">Venc. {formatBR(g.vencimento)}</span>
                              {g.numeroBoleto && g.numeroBoleto !== "0" && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  · boleto {g.numeroBoleto}
                                </span>
                              )}
                              {g.quitado ? (
                                <Badge className="ml-2 border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                  Baixado{g.dataPagamento ? ` ${formatBR(g.dataPagamento)}` : ""}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="ml-2 border-amber-500/40 text-amber-700 dark:text-amber-300"
                                >
                                  Em aberto
                                </Badge>
                              )}
                              {casaValor && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                                >
                                  bate com a linha
                                </Badge>
                              )}
                            </div>
                            <span className="font-mono text-sm">{formatBRL(g.total)}</span>
                          </div>

                          <div className="mt-2 space-y-1 pl-6">
                            {g.linhas.map((t) => {
                              const chave = chaveLinha(t);
                              const marcada = chave in selecionadas;
                              return (
                                <div key={chave} className="flex items-center gap-2 text-xs">
                                  <Checkbox
                                    checked={marcada}
                                    onCheckedChange={(c) => alternarLinha(t, c === true)}
                                  />
                                  <span className="min-w-0 flex-1 truncate">
                                    {t.categoria}
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · parcela {t.numeroParcela}
                                      {t.tipoRecebimento ? ` · ${t.tipoRecebimento}` : ""}
                                    </span>
                                  </span>
                                  {marcada ? (
                                    <Input
                                      className="h-7 w-28 text-right font-mono text-xs"
                                      inputMode="decimal"
                                      value={selecionadas[chave]}
                                      onChange={(e) =>
                                        setSelecionadas((atual) => ({
                                          ...atual,
                                          [chave]: e.target.value,
                                        }))
                                      }
                                    />
                                  ) : (
                                    <span className="w-28 text-right font-mono">
                                      {formatBRL(valorReferencia(t))}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  className={`flex items-center justify-between rounded-md border p-3 text-sm ${
                    bate && qtdSelecionadas > 0
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-amber-500/40 bg-amber-500/5"
                  }`}
                >
                  <span>
                    {qtdSelecionadas} título(s) · soma{" "}
                    <strong className="font-mono">{formatBRL(soma)}</strong>
                  </span>
                  {bate && qtdSelecionadas > 0 ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                      Bate com o total
                    </Badge>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">
                      {diferenca >= 0 ? "Faltam" : "Excedem"}{" "}
                      <strong className="font-mono">{formatBRL(Math.abs(diferenca))}</strong>
                    </span>
                  )}
                </div>

                {algumEmAberto && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
                    Há título selecionado <strong>ainda em aberto no Sponte</strong>. O vínculo será
                    registrado apenas no School Hub — a baixa precisa ser dada no Sponte.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmar}
            disabled={!aluno || qtdSelecionadas === 0 || !bate || salvando}
          >
            {salvando ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            Confirmar Vínculo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
