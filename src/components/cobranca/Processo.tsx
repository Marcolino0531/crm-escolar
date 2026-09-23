// Cobrança manual — seção do processo judicial na tela do caso (PR 3).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gavel, HandCoins, Loader2, Paperclip, Pencil, Plus, Scale, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  TIPOS_ANEXO_ACEITOS,
  formatarBRL,
  formatarDataBR,
  type CasoCompleto,
} from "@/lib/cobranca-casos";
import { assinarUploadCobranca } from "@/lib/cobranca-casos.functions";
import {
  TIPOS_ACAO,
  TIPOS_ANDAMENTO,
  TIPOS_RECEBIMENTO,
  labelTipoAcao,
  labelTipoAndamento,
  labelTipoRecebimento,
  painelProcesso,
  validarAndamento,
  validarProcesso,
  validarRecebimento,
} from "@/lib/cobranca-processos";
import {
  atualizarProcessoCobranca,
  carregarProcessoCaso,
  iniciarProcessoCobranca,
  registrarAndamentoCobranca,
  registrarRecebimentoCobranca,
  type ProcessoDetalhe,
} from "@/lib/cobranca-processos.functions";
import { enviarArquivoCobranca } from "@/lib/cobranca-upload";

const ACCEPT_ANEXO = TIPOS_ANEXO_ACEITOS.join(",");

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseValor(s: string): number {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export function useProcessoCaso(casoId: string) {
  const carregar = useServerFn(carregarProcessoCaso);
  return useQuery({
    queryKey: ["cobranca_processo", casoId],
    queryFn: () => carregar({ data: { casoId } }),
  });
}

export function SecaoProcesso({
  caso,
  prontoParaProcesso,
  edita,
  onDone,
}: {
  caso: CasoCompleto;
  prontoParaProcesso: boolean;
  edita: boolean;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const q = useProcessoCaso(caso.id);
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["cobranca_processo", caso.id] });
    void qc.invalidateQueries({ queryKey: ["cobranca_avisos_prazo"] });
    onDone();
  };

  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.error || !q.data)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {mensagemErro(q.error ?? "Processo não carregado.")}
      </div>
    );
  const d = q.data;

  if (!d.processo) {
    if (!prontoParaProcesso) return null;
    return (
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <Scale className="h-4 w-4" /> Processo judicial
        </h3>
        <p className="text-sm text-muted-foreground">
          O prazo da notificação encerrou sem regularização. Registre o ajuizamento para acompanhar
          o processo aqui.
        </p>
        {edita && <ProcessoDialog caso={caso} detalhe={d} onDone={recarregar} />}
      </section>
    );
  }

  const p = d.processo;
  const painel = painelProcesso(p, d.recebimentos);

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Scale className="h-4 w-4" /> Processo judicial
        </h3>
        {edita && <ProcessoDialog caso={caso} detalhe={d} onDone={recarregar} />}
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <Info label="Tipo de ação" valor={labelTipoAcao(p.tipo_acao)} />
        <Info label="Número do processo" valor={p.numero_processo ?? "sem número"} />
        <Info label="Ajuizamento" valor={formatarDataBR(p.data_ajuizamento)} />
        <Info label="Comarca" valor={p.comarca ?? "—"} />
        <Info label="Vara" valor={p.vara ?? "—"} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Painel label="Valor da causa" valor={formatarBRL(painel.valorCausa)} />
        <Painel label="Total recebido" valor={formatarBRL(painel.totalRecebido)} />
        <Painel
          label="Saldo"
          valor={formatarBRL(painel.saldo)}
          destaque={painel.acimaDaCausa ? "recebido acima do valor da causa" : undefined}
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Gavel className="h-4 w-4" /> Andamentos
          </h4>
          {edita && <AndamentoDialog casoId={caso.id} hojeYMD={d.hojeYMD} onDone={recarregar} />}
        </div>
        {d.andamentos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum andamento registrado.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {d.andamentos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                <div>
                  <p className="font-medium">
                    {formatarDataBR(a.data)} · {labelTipoAndamento(a.tipo)}
                  </p>
                  {a.descricao && <p className="text-muted-foreground">{a.descricao}</p>}
                  {a.prazo_data && (
                    <p className="text-xs font-medium text-amber-700">
                      {a.tipo === "audiencia" ? "Audiência" : "Prazo"} em{" "}
                      {formatarDataBR(a.prazo_data)}
                      {a.prazo_descricao ? ` — ${a.prazo_descricao}` : ""}
                    </p>
                  )}
                </div>
                {a.anexo_url && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={a.anexo_url} target="_blank" rel="noreferrer">
                      <Paperclip className="mr-1 h-4 w-4" /> Anexo
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <HandCoins className="h-4 w-4" /> Valores recebidos
          </h4>
          {edita && <RecebimentoDialog casoId={caso.id} hojeYMD={d.hojeYMD} onDone={recarregar} />}
        </div>
        {d.recebimentos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum valor recebido registrado.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {d.recebimentos.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                <div>
                  <p className="font-medium">
                    {formatarDataBR(r.data)} · {labelTipoRecebimento(r.tipo)} ·{" "}
                    {formatarBRL(r.valor)}
                  </p>
                  {r.observacao && <p className="text-muted-foreground">{r.observacao}</p>}
                </div>
                {r.anexo_url && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={r.anexo_url} target="_blank" rel="noreferrer">
                      <Paperclip className="mr-1 h-4 w-4" /> Comprovante
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Info({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{valor}</p>
    </div>
  );
}

function Painel({ label, valor, destaque }: { label: string; valor: string; destaque?: string }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${destaque ? "border-amber-300 bg-amber-50" : "border-border bg-muted/40"}`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{valor}</p>
      {destaque && <p className="text-xs font-medium text-amber-800">{destaque}</p>}
    </div>
  );
}

// ─── Iniciar / editar processo ───────────────────────────────────────────────

function ProcessoDialog({
  caso,
  detalhe,
  onDone,
}: {
  caso: CasoCompleto;
  detalhe: ProcessoDetalhe;
  onDone: () => void;
}) {
  const existente = detalhe.processo;
  const iniciar = useServerFn(iniciarProcessoCobranca);
  const atualizar = useServerFn(atualizarProcessoCobranca);
  const [aberto, setAberto] = useState(false);
  const [tipoAcao, setTipoAcao] = useState(existente?.tipo_acao ?? "");
  const [numero, setNumero] = useState(existente?.numero_processo ?? "");
  const [comarca, setComarca] = useState(existente?.comarca ?? "Belo Horizonte");
  const [vara, setVara] = useState(existente?.vara ?? "");
  const [dataAjuizamento, setDataAjuizamento] = useState(
    existente?.data_ajuizamento ?? detalhe.hojeYMD,
  );
  const [valorCausa, setValorCausa] = useState(
    (existente?.valor_causa ?? detalhe.sugestaoValorCausa).toFixed(2).replace(".", ","),
  );

  const salvar = useMutation({
    mutationFn: async () => {
      const valor = parseValor(valorCausa);
      const invalido = validarProcesso({
        tipo_acao: tipoAcao,
        data_ajuizamento: dataAjuizamento,
        valor_causa: valor,
      });
      if (invalido) throw new Error(invalido);
      const payload = {
        casoId: caso.id,
        tipoAcao,
        numeroProcesso: numero,
        comarca,
        vara,
        dataAjuizamento,
        valorCausa: valor,
      };
      if (existente) await atualizar({ data: payload });
      else await iniciar({ data: payload });
    },
    onSuccess: () => {
      toast.success(existente ? "Dados do processo atualizados." : "Processo iniciado.");
      setAberto(false);
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      <Button size="sm" variant={existente ? "outline" : "default"} onClick={() => setAberto(true)}>
        {existente ? <Pencil className="mr-2 h-4 w-4" /> : <Scale className="mr-2 h-4 w-4" />}
        {existente ? "Editar dados do processo" : "Iniciar processo judicial"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{existente ? "Editar processo" : "Iniciar processo judicial"}</DialogTitle>
            <DialogDescription>
              {existente
                ? "Atualize o número, comarca, vara ou valor da causa."
                : `Sugestão do valor da causa: ${formatarBRL(detalhe.sugestaoValorCausa)} (demonstrativo mais recente ou valor inicial).`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Tipo de ação</Label>
              <Select value={tipoAcao} onValueChange={setTipoAcao}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ACAO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Número do processo (opcional)</Label>
              <Input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="0000000-00.0000.0.00.0000"
              />
            </div>
            <div className="space-y-1">
              <Label>Comarca</Label>
              <Input value={comarca} onChange={(e) => setComarca(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Vara</Label>
              <Input value={vara} onChange={(e) => setVara(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Data do ajuizamento</Label>
              <Input
                type="date"
                value={dataAjuizamento}
                onChange={(e) => setDataAjuizamento(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Valor da causa (R$)</Label>
              <Input
                inputMode="decimal"
                value={valorCausa}
                onChange={(e) => setValorCausa(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {existente ? "Salvar alterações" : "Iniciar processo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Anexo opcional ──────────────────────────────────────────────────────────

function CampoAnexo({
  arquivo,
  onChange,
}: {
  arquivo: File | null;
  onChange: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1">
      <Label>Anexo (opcional)</Label>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT_ANEXO}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          onChange(f);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()}>
          <Paperclip className="mr-2 h-4 w-4" /> {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
        </Button>
        {arquivo && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {arquivo.name}
            <button type="button" onClick={() => onChange(null)} aria-label="Remover anexo">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Andamento ───────────────────────────────────────────────────────────────

function AndamentoDialog({
  casoId,
  hojeYMD,
  onDone,
}: {
  casoId: string;
  hojeYMD: string;
  onDone: () => void;
}) {
  const registrar = useServerFn(registrarAndamentoCobranca);
  const assinar = useServerFn(assinarUploadCobranca);
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(hojeYMD);
  const [tipo, setTipo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [prazoData, setPrazoData] = useState("");
  const [prazoDescricao, setPrazoDescricao] = useState("");

  const salvar = useMutation({
    mutationFn: async () => {
      const invalido = validarAndamento({
        data,
        tipo,
        prazo_data: prazoData || null,
        prazo_descricao: prazoDescricao || null,
      });
      if (invalido) throw new Error(invalido);
      const anexo = arquivo
        ? await enviarArquivoCobranca(assinar, casoId, arquivo, arquivo.name)
        : null;
      await registrar({
        data: {
          casoId,
          data,
          tipo,
          descricao,
          anexoPath: anexo?.path ?? null,
          prazoData: prazoData || null,
          prazoDescricao,
        },
      });
    },
    onSuccess: () => {
      toast.success("Andamento registrado.");
      setAberto(false);
      setTipo("");
      setDescricao("");
      setArquivo(null);
      setPrazoData("");
      setPrazoDescricao("");
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
        <Plus className="mr-2 h-4 w-4" /> Registrar andamento
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar andamento</DialogTitle>
            <DialogDescription>
              Entra na linha do tempo do caso. Informe prazo ou audiência para receber lembretes no
              sino (5, 3 e 1 dia antes).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ANDAMENTO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Descrição</Label>
              <Textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <CampoAnexo arquivo={arquivo} onChange={setArquivo} />
            </div>
            <div className="space-y-1">
              <Label>Data do prazo / audiência (opcional)</Label>
              <Input type="date" value={prazoData} onChange={(e) => setPrazoData(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Descrição do prazo</Label>
              <Input
                value={prazoDescricao}
                onChange={(e) => setPrazoDescricao(e.target.value)}
                placeholder="Ex.: Audiência de conciliação"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Recebimento ─────────────────────────────────────────────────────────────

function RecebimentoDialog({
  casoId,
  hojeYMD,
  onDone,
}: {
  casoId: string;
  hojeYMD: string;
  onDone: () => void;
}) {
  const registrar = useServerFn(registrarRecebimentoCobranca);
  const assinar = useServerFn(assinarUploadCobranca);
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(hojeYMD);
  const [tipo, setTipo] = useState("");
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);

  const salvar = useMutation({
    mutationFn: async () => {
      const v = parseValor(valor);
      const invalido = validarRecebimento({ data, tipo, valor: v });
      if (invalido) throw new Error(invalido);
      const anexo = arquivo
        ? await enviarArquivoCobranca(assinar, casoId, arquivo, arquivo.name)
        : null;
      await registrar({
        data: { casoId, data, tipo, valor: v, observacao, anexoPath: anexo?.path ?? null },
      });
    },
    onSuccess: () => {
      toast.success("Valor recebido registrado.");
      setAberto(false);
      setTipo("");
      setValor("");
      setObservacao("");
      setArquivo(null);
      onDone();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
        <Plus className="mr-2 h-4 w-4" /> Registrar valor recebido
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar valor recebido</DialogTitle>
            <DialogDescription>
              Parcela de acordo, bloqueio, alvará ou pagamento direto.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RECEBIMENTO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Valor (R$)</Label>
              <Input
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1">
              <Label>Observação</Label>
              <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <CampoAnexo arquivo={arquivo} onChange={setArquivo} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
