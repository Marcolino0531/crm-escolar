import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Download,
  FileSignature,
  Gavel,
  Handshake,
  Loader2,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
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
  type ParcelaAcordoAcompanhada,
  type ValorCausaAcordo,
} from "@/lib/cobranca-acordo";
import {
  formatarBRL,
  formatarDataBR,
  formatarDataHora,
  termoAssinadoDoCaso,
  type CasoCompleto,
} from "@/lib/cobranca-casos";
import {
  anexarTermoAssinadoUpload,
  anexarTermoAssinadoZapSign,
  assinarUploadCobranca,
  iniciarExecucaoAcordo,
  listarTermosAcordo,
  listarTermosAssinadosZapSign,
  registrarAcordoCobranca,
  type AcordoDetalhe,
  type AnexoComLink,
} from "@/lib/cobranca-casos.functions";
import { enviarArquivoCobranca } from "@/lib/cobranca-upload";

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

// ─── Execução ────────────────────────────────────────────────────────────────

function ExecucaoDialog({
  casoId,
  numeroTermo,
  valorCausa,
  onDone,
}: {
  casoId: string;
  numeroTermo: number | string;
  valorCausa: ValorCausaAcordo | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const executar = useMutation({
    mutationFn: () => iniciarExecucaoAcordo({ data: { casoId } }),
    onSuccess: () => {
      toast.success("Cobrança em Execução em preparação.");
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Gavel className="mr-2 h-4 w-4" /> Execução
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Execução</DialogTitle>
            <DialogDescription>
              O acordo não foi cumprido. A cobrança vai para Execução em preparação, para início da
              execução do Termo de Confissão de Dívida nº {numeroTermo}.
            </DialogDescription>
          </DialogHeader>
          {valorCausa && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">Valor da causa sugerido</p>
              <p className="text-lg font-semibold">{formatarBRL(valorCausa.total)}</p>
              <p className="text-xs text-muted-foreground">
                Vencidas atualizadas {formatarBRL(valorCausa.vencidasAtualizadas)} · vincendas{" "}
                {formatarBRL(valorCausa.vincendas)} · cláusula penal{" "}
                {formatarBRL(valorCausa.clausulaPenal)} · {valorCausa.nota}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={executar.isPending}
              onClick={() => executar.mutate()}
            >
              {executar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar execução
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Termo assinado ──────────────────────────────────────────────────────────

function BuscarZapSignDialog({
  casoId,
  substituir,
  onDone,
}: {
  casoId: string;
  substituir: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const docs = useQuery({
    queryKey: ["cobranca-termos-zapsign", casoId],
    queryFn: () => listarTermosAssinadosZapSign({ data: { casoId } }),
    enabled: open,
  });
  const anexar = useMutation({
    mutationFn: (documentoId: string) =>
      anexarTermoAssinadoZapSign({ data: { casoId, documentoId } }),
    onSuccess: () => {
      toast.success("Termo assinado anexado.");
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {substituir ? <RefreshCw className="mr-2 h-4 w-4" /> : <Search className="mr-2 h-4 w-4" />}
        {substituir ? "Substituir (ZapSign)" : "Buscar no ZapSign"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Termo assinado na ZapSign</DialogTitle>
            <DialogDescription>
              Documentos assinados (produção) desta unidade. O PDF é copiado pelo servidor para os
              anexos da cobrança.
            </DialogDescription>
          </DialogHeader>
          {docs.isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando documentos…
            </p>
          )}
          {docs.error && <p className="text-sm text-red-700">{mensagemErro(docs.error)}</p>}
          {docs.data && docs.data.length === 0 && (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Nenhum documento assinado nesta unidade.
            </p>
          )}
          {docs.data && docs.data.length > 0 && (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {docs.data.map((d) => (
                <li key={d.documentoId}>
                  <button
                    type="button"
                    onClick={() => setEscolhido(d.documentoId)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                      escolhido === d.documentoId
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium">
                        <FileSignature className="h-4 w-4 shrink-0" /> {d.nome}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {d.assinadoEm ? formatarDataHora(d.assinadoEm) : "—"}
                      </span>
                    </div>
                    {d.signatarios.length > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {d.signatarios.join(" · ")}
                      </div>
                    )}
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
              disabled={!escolhido || anexar.isPending}
              onClick={() => escolhido && anexar.mutate(escolhido)}
            >
              {anexar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Anexar termo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AnexarPdfButton({
  casoId,
  substituir,
  onDone,
}: {
  casoId: string;
  substituir: boolean;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const enviar = useMutation({
    mutationFn: async (file: File) => {
      if (file.type !== "application/pdf") throw new Error("Escolha um arquivo PDF.");
      const arquivo = await enviarArquivoCobranca(assinarUploadCobranca, casoId, file, file.name);
      return anexarTermoAssinadoUpload({ data: { casoId, arquivo } });
    },
    onSuccess: () => {
      toast.success("Termo assinado anexado.");
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) enviar.mutate(f);
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={enviar.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {enviar.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        {substituir ? "Substituir (PDF)" : "Anexar PDF"}
      </Button>
    </>
  );
}

function TermoAssinadoBloco({
  caso,
  anexos,
  edita,
  onDone,
}: {
  caso: CasoCompleto;
  anexos: AnexoComLink[];
  edita: boolean;
  onDone: () => void;
}) {
  const termo = termoAssinadoDoCaso(anexos);
  return (
    <div className="mb-3 rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <FileSignature className="h-4 w-4" /> Termo assinado
          </p>
          {termo ? (
            <p className="text-xs text-muted-foreground">
              {termo.nome_arquivo} · {termo.origem === "sistema" ? "ZapSign" : "anexado"} ·{" "}
              {formatarDataHora(termo.created_at)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhum termo assinado anexado a esta cobrança.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {termo?.url && (
            <Button asChild variant="outline" size="sm">
              <a href={termo.url} target="_blank" rel="noreferrer">
                <Download className="mr-2 h-4 w-4" /> Baixar
              </a>
            </Button>
          )}
          {edita && (
            <>
              <BuscarZapSignDialog casoId={caso.id} substituir={!!termo} onDone={onDone} />
              <AnexarPdfButton casoId={caso.id} substituir={!!termo} onDone={onDone} />
            </>
          )}
        </div>
      </div>
    </div>
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
  anexos,
  edita,
  onDone,
}: {
  caso: CasoCompleto;
  acordo: AcordoDetalhe;
  anexos: AnexoComLink[];
  edita: boolean;
  onDone: () => void;
}) {
  const a = acordo.acompanhamento;
  const atrasadas = a.parcelas.filter((p) => p.situacao === "em_atraso");
  const emExecucao = caso.status === "acordo" && !!caso.acordo_quebrado_em;
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
        {edita && emAcordo && !emExecucao && passouVencimentoAntecipado(a) && (
          <ExecucaoDialog
            casoId={caso.id}
            numeroTermo={acordo.termo.numero}
            valorCausa={acordo.valorCausa}
            onDone={onDone}
          />
        )}
      </div>

      <TermoAssinadoBloco caso={caso} anexos={anexos} edita={edita} onDone={onDone} />

      {acordo.indisponivel && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Não foi possível ler o Sponte agora para algum aluno: a situação pode estar incompleta.
        </p>
      )}
      {emExecucao && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Execução iniciada em {formatarDataHora(caso.acordo_quebrado_em!)}. Execução em preparação
          {acordo.valorCausa
            ? ` · valor da causa sugerido ${formatarBRL(acordo.valorCausa.total)} (${acordo.valorCausa.nota})`
            : ""}
          .
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
