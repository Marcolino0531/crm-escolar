import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileSignature, Handshake, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DIAS_ATRASO_VENCIMENTO_ANTECIPADO,
  labelSituacaoParcela,
  passouVencimentoAntecipado,
  temParcelaEmAtraso,
  type ParcelaAcordoAcompanhada,
} from "@/lib/cobranca-acordo";
import {
  formatarBRL,
  formatarDataBR,
  formatarDataHora,
  type CasoCompleto,
} from "@/lib/cobranca-casos";
import {
  listarTermosAcordo,
  registrarAcordoCobranca,
  registrarQuebraAcordo,
  type AcordoDetalhe,
} from "@/lib/cobranca-casos.functions";

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── Registrar acordo ─────────────────────────────────────────────────────────

export function RegistrarAcordoDialog({ casoId, onDone }: { casoId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const termos = useQuery({
    queryKey: ["cobranca-termos-acordo", casoId],
    queryFn: () => listarTermosAcordo({ data: { casoId } }),
    enabled: open,
  });
  const registrar = useMutation({
    mutationFn: (documentoId: string) => registrarAcordoCobranca({ data: { casoId, documentoId } }),
    onSuccess: () => {
      toast.success("Acordo registrado.");
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Handshake className="mr-2 h-4 w-4" /> Registrar acordo
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Registrar acordo</DialogTitle>
            <DialogDescription>
              Escolha o Termo de Confissão de Dívida assinado. Só aparecem termos desta unidade
              ligados a um aluno do caso ou ao CPF do responsável, e ainda não usados em outra
              cobrança.
            </DialogDescription>
          </DialogHeader>
          {termos.isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando termos…
            </p>
          )}
          {termos.error && <p className="text-sm text-red-700">{mensagemErro(termos.error)}</p>}
          {termos.data && termos.data.length === 0 && (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Nenhum Termo de Confissão de Dívida compatível com este caso. Gere o termo em
              Documentos antes de registrar o acordo.
            </p>
          )}
          {termos.data && termos.data.length > 0 && (
            <ul className="space-y-2">
              {termos.data.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setEscolhido(t.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                      escolhido === t.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-medium">
                        <FileSignature className="h-4 w-4" /> Termo nº {t.numero}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatarDataBR(t.dataTermo)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatarBRL(t.valorTotal)} em {t.totalParcelas} parcela
                      {t.totalParcelas === 1 ? "" : "s"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!escolhido || registrar.isPending}
              onClick={() => escolhido && registrar.mutate(escolhido)}
            >
              {registrar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar acordo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Quebra ──────────────────────────────────────────────────────────────────

function QuebraAcordoDialog({ casoId, onDone }: { casoId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const quebrar = useMutation({
    mutationFn: () => registrarQuebraAcordo({ data: { casoId } }),
    onSuccess: () => {
      toast.success("Quebra do acordo registrada.");
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <AlertTriangle className="mr-2 h-4 w-4" /> Registrar quebra do acordo
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar quebra do acordo</DialogTitle>
            <DialogDescription>
              O caso passa para &quot;Pronto para processo&quot; e o processo judicial pode ser
              iniciado com o valor da causa calculado pelas parcelas do termo. Nada é alterado no
              Sponte.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={quebrar.isPending}
              onClick={() => quebrar.mutate()}
            >
              {quebrar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar quebra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Card Acordo ─────────────────────────────────────────────────────────────

function classeSituacao(p: ParcelaAcordoAcompanhada): string {
  switch (p.situacao) {
    case "paga":
      return "text-emerald-700";
    case "paga_parcialmente":
      return "text-amber-700";
    case "em_atraso":
      return "text-red-700 font-medium";
    case "nao_encontrada":
      return "text-orange-700";
    default:
      return "text-muted-foreground";
  }
}

export function SecaoAcordo({
  caso,
  acordo,
  edita,
  onDone,
}: {
  caso: CasoCompleto;
  acordo: AcordoDetalhe;
  edita: boolean;
  onDone: () => void;
}) {
  const a = acordo.acompanhamento;
  const atrasadas = a.parcelas.filter((p) => p.situacao === "em_atraso");
  const quebrado = caso.status === "acordo" && !!caso.acordo_quebrado_em;
  const emAcordo = caso.status === "acordo";
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Handshake className="h-4 w-4" /> Acordo · Termo nº {acordo.termo.numero}
          </h3>
          <p className="text-xs text-muted-foreground">
            Termo de {formatarDataBR(acordo.termo.dataTermo)}
            {caso.acordo_registrado_em
              ? ` · registrado em ${formatarDataHora(caso.acordo_registrado_em)}`
              : ""}
          </p>
        </div>
        {edita && emAcordo && !quebrado && temParcelaEmAtraso(a) && (
          <QuebraAcordoDialog casoId={caso.id} onDone={onDone} />
        )}
      </div>

      {acordo.indisponivel && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Não foi possível ler o Sponte agora para algum aluno: a situação pode estar incompleta.
        </p>
      )}
      {quebrado && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Acordo quebrado em {formatarDataHora(caso.acordo_quebrado_em!)}. Pronto para processo.
        </p>
      )}
      {atrasadas.length > 0 && (
        <div className="mb-3 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {atrasadas.map((p) => (
            <p key={p.numero}>
              Parcela {p.numero}/{p.total} em atraso há {p.diasAtraso} dia
              {p.diasAtraso === 1 ? "" : "s"}
            </p>
          ))}
          {passouVencimentoAntecipado(a) && (
            <p className="font-medium">
              Mais de {DIAS_ATRASO_VENCIMENTO_ANTECIPADO} dias: pelo termo (cláusula 5), vencem
              antecipadamente todas as parcelas, com cláusula penal de 20%.
            </p>
          )}
        </div>
      )}
      {a.temNaoEncontrada && (
        <p className="mb-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          Há parcela do termo sem par na categoria &quot;Acordo&quot; do Sponte (mesmo valor e
          vencimento até 5 dias). Confira o lançamento no Sponte.
        </p>
      )}

      <div className="mb-3 grid gap-3 text-sm sm:grid-cols-4">
        <Resumo label="Total do acordo" valor={formatarBRL(a.totalAcordo)} />
        <Resumo label="Total pago" valor={formatarBRL(a.totalPago)} />
        <Resumo label="Saldo restante" valor={formatarBRL(a.saldoRestante)} />
        <Resumo
          label="Próxima parcela"
          valor={
            a.proximaParcela
              ? `${a.proximaParcela.numero}/${a.proximaParcela.total} · ${formatarDataBR(a.proximaParcela.vencimento)}`
              : a.quitado
                ? "Quitado"
                : "—"
          }
          destaque
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Parcela</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="text-right">Pago</TableHead>
            <TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {a.parcelas.map((p) => (
            <TableRow
              key={p.numero}
              className={a.proximaParcela?.numero === p.numero ? "bg-primary/5" : undefined}
            >
              <TableCell>
                {p.numero}/{p.total}
              </TableCell>
              <TableCell>{formatarDataBR(p.vencimento)}</TableCell>
              <TableCell className="text-right">{formatarBRL(p.valor)}</TableCell>
              <TableCell className="text-right">
                {p.valorPago > 0 ? formatarBRL(p.valorPago) : "—"}
                {p.dataPagamento ? (
                  <span className="block text-xs text-muted-foreground">
                    {formatarDataBR(p.dataPagamento)}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className={classeSituacao(p)}>{labelSituacaoParcela(p)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function Resumo({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={destaque ? "rounded-md bg-primary/5 px-2 py-1" : undefined}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{valor}</p>
    </div>
  );
}
