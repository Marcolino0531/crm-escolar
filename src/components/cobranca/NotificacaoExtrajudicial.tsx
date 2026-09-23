// Modelo "Notificação Extrajudicial" (Documentos) e bloco "Registrar envio da
// notificação" — compartilhado com a tela do caso em Cobrança. O débito é
// recalculado no servidor na emissão (parcelas em aberto atuais do Sponte).

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2, Send } from "lucide-react";
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
import { SelecioneUnidade, useUnidadeAtiva } from "@/components/SelecioneUnidade";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, usePermissions, useSchool } from "@/lib/app-context";
import { carregarLogoDoColegio, paraColegioRecibo, useColegios } from "@/lib/colegios";
import {
  formatarCpf,
  formatarDataBR,
  labelEtapa,
  etapaDoCaso,
  type StatusCaso,
} from "@/lib/cobranca-casos";
import {
  assinarUploadCobranca,
  debitoAtualCaso,
  listarCasosParaNotificacao,
  marcarNotificacaoGerada,
  registrarEnvioNotificacao,
} from "@/lib/cobranca-casos.functions";
import { gerarPdfNotificacao, nomeArquivoSeguro } from "@/lib/cobranca-casos-pdf";
import { enviarArquivoCobranca } from "@/lib/cobranca-upload";
import {
  camposFaltantesColegio,
  montarNotificacao,
  type NotificacaoDocumento,
} from "@/lib/notificacao-extrajudicial";
import type { ColegioRecibo } from "@/lib/recibos";

export type NotificacaoSnapshot = {
  colegio: ColegioRecibo;
  casoId: string;
  notificacao: NotificacaoDocumento;
};

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function GerarNotificacaoExtrajudicial({ casoIdInicial }: { casoIdInicial?: string }) {
  const { canEdit } = usePermissions();
  const { session } = useAuth();
  const qc = useQueryClient();
  const podeEditar = canEdit("documentos") && canEdit("financeiro_cobranca");
  const unidade = useUnidadeAtiva() ?? "";
  const { schools, setSelected } = useSchool();
  const { data: colegios = [] } = useColegios();
  const listar = useServerFn(listarCasosParaNotificacao);
  const debito = useServerFn(debitoAtualCaso);
  const marcarGerada = useServerFn(marcarNotificacaoGerada);

  const [casoId, setCasoId] = useState(casoIdInicial ?? "");

  useEffect(() => {
    if (casoIdInicial) setCasoId(casoIdInicial);
  }, [casoIdInicial]);

  const casos = useQuery({
    queryKey: ["cobranca_casos_notificacao", unidade],
    queryFn: () => listar({ data: { unidade } }),
    enabled: !!unidade && podeEditar,
  });

  const debitoAtual = useQuery({
    queryKey: ["cobranca_debito_atual", casoId],
    queryFn: () => debito({ data: { casoId } }),
    enabled: !!casoId,
  });

  // Caso vindo da Cobrança de outra unidade: o seletor global troca para a
  // unidade do caso (a tela nunca mostra item fora do que o topo indica).
  const unidadeCaso = debitoAtual.data?.caso.unidade;
  const casoSincronizado = useRef<string | null>(null);
  useEffect(() => {
    if (!unidadeCaso || !casoId || casoSincronizado.current === casoId) return;
    casoSincronizado.current = casoId;
    if (unidadeCaso === unidade) return;
    const alvo = schools.find((s) => s.name === unidadeCaso);
    if (alvo) setSelected(alvo.id);
  }, [unidadeCaso, casoId, unidade, schools, setSelected]);

  // Caso selecionado que não pertence à unidade do topo (topo trocado pelo
  // usuário) sai da seleção.
  const alinhado = useRef(false);
  useEffect(() => {
    if (!casoId || !unidadeCaso) return;
    if (unidadeCaso === unidade) {
      alinhado.current = true;
      return;
    }
    if (alinhado.current && unidade) {
      alinhado.current = false;
      setCasoId("");
    }
  }, [casoId, unidade, unidadeCaso]);

  const colegioRow = colegios.find(
    (c) => c.unidade === (debitoAtual.data?.caso.unidade ?? unidade),
  );
  const colegio = colegioRow ? paraColegioRecibo(colegioRow) : null;
  const faltantes = colegio ? camposFaltantesColegio(colegio) : [];

  const previa = useMemo(() => {
    if (!colegio || !debitoAtual.data) return null;
    const { caso, mensagens, demonstrativo } = debitoAtual.data;
    return montarNotificacao({
      colegio,
      responsavel: {
        nome: caso.responsavel_nome,
        cpf: caso.responsavel_cpf ?? "",
        endereco: caso.responsavel_endereco,
      },
      alunos: caso.alunos.map((a) => a.nome),
      demonstrativo,
      datasMensagens: [...mensagens]
        .sort((a, b) => a.ordem - b.ordem)
        .map((m) => m.data_envio ?? m.data_prevista),
      dataEmissao: hojeYMD(),
    });
  }, [colegio, debitoAtual.data]);

  const gerar = useMutation({
    mutationFn: async () => {
      if (!colegio || !colegioRow || !previa || !debitoAtual.data)
        throw new Error("Notificação incompleta.");
      if (faltantes.length > 0) throw new Error("Preencha os dados da unidade antes de emitir.");
      if (debitoAtual.data.demonstrativo.parcelas.length === 0)
        throw new Error("Não há parcela vencida em aberto no Sponte para este caso.");
      const { caso } = debitoAtual.data;
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const snapshot: NotificacaoSnapshot = { colegio, casoId: caso.id, notificacao: previa };
      const { data, error } = await supabase
        .from("documentos_recibos" as never)
        .insert({
          tipo: "notificacao_extrajudicial",
          unidade: caso.unidade,
          aluno_id: caso.alunos[0]?.aluno_id ?? "",
          aluno_nome: caso.alunos.map((a) => a.nome).join(", "),
          responsavel_id: "",
          responsavel_nome: caso.responsavel_nome,
          responsavel_cpf: caso.responsavel_cpf ?? "",
          data_recibo: hojeYMD(),
          valor_total: previa.total,
          itens: [],
          snapshot,
          created_by: session?.user?.id ?? null,
          created_by_nome: meta?.full_name || session?.user?.email || "",
        } as never)
        .select("numero")
        .single();
      if (error) throw new Error(error.message);
      const numero = Number((data as unknown as { numero: number }).numero);
      await marcarGerada({ data: { casoId: caso.id } });
      const doc = await gerarPdfNotificacao(
        previa,
        colegio,
        numero,
        await carregarLogoDoColegio(colegioRow.logo_path),
      );
      doc.save(
        `notificacao-extrajudicial-${numero}-${nomeArquivoSeguro(caso.responsavel_nome)}.pdf`,
      );
      return numero;
    },
    onSuccess: (numero) => {
      toast.success(`Notificação nº ${numero} gerada e baixada.`);
      qc.invalidateQueries({ queryKey: ["documentos_recibos"] });
      qc.invalidateQueries({ queryKey: ["cobranca_caso", casoId] });
      qc.invalidateQueries({ queryKey: ["cobranca_casos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao gerar a notificação."),
  });

  if (!podeEditar) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        A notificação extrajudicial exige permissão de edição em Documentos e em Cobrança.
      </div>
    );
  }
  if (!unidade && !casoIdInicial) return <SelecioneUnidade acao="A notificação extrajudicial" />;

  const caso = debitoAtual.data?.caso;

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">
            Cobrança (etapa Notificação ou Aguardando prazo) — {unidade || caso?.unidade}
          </Label>
          <Select value={casoId} onValueChange={setCasoId}>
            <SelectTrigger className="h-9 w-full max-w-xl">
              <SelectValue placeholder={casos.isLoading ? "Carregando…" : "Selecione o caso"} />
            </SelectTrigger>
            <SelectContent>
              {(casos.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.responsavel_nome} — {c.alunos.map((a) => a.nome).join(", ")} ·{" "}
                  {labelEtapa(etapaDoCaso(c, hojeYMD()))}
                </SelectItem>
              ))}
              {casos.data && casos.data.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Nenhuma cobrança nesta etapa.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
      </section>

      {faltantes.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Faltam dados da unidade em Configurações → Dados dos Colégios:{" "}
            <strong>{faltantes.join(", ")}</strong>. Preencha para emitir a notificação.
          </div>
        </div>
      )}

      {casoId && debitoAtual.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Recalculando o débito no Sponte…
        </div>
      )}
      {debitoAtual.error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {debitoAtual.error instanceof Error ? debitoAtual.error.message : "Falha ao carregar."}
        </div>
      )}

      {caso && previa && debitoAtual.data && (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Responsável:</span> {caso.responsavel_nome}{" "}
                {caso.responsavel_cpf && `· CPF ${formatarCpf(caso.responsavel_cpf)}`}
              </div>
              <div>
                <span className="text-muted-foreground">Aluno(s):</span>{" "}
                {caso.alunos.map((a) => a.nome).join(", ")}
              </div>
            </div>
            {debitoAtual.data.indisponivel && (
              <p className="text-xs text-amber-700">
                Sponte indisponível para parte dos alunos: as parcelas podem estar incompletas.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1 text-left">Descrição</th>
                    <th className="py-1 text-left">Vencimento</th>
                    <th className="py-1 text-right">Original</th>
                    <th className="py-1 text-right">Multa</th>
                    <th className="py-1 text-right">Juros</th>
                    <th className="py-1 text-right">Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.tabela.map((l, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1">{l.descricao}</td>
                      <td className="py-1">{l.vencimento}</td>
                      <td className="py-1 text-right">{l.original}</td>
                      <td className="py-1 text-right">{l.multa}</td>
                      <td className="py-1 text-right">{l.juros}</td>
                      <td className="py-1 text-right font-medium">{l.atualizado}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-right font-semibold">{previa.linhaTotal}</p>
            <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">
              {previa.qualificacao.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              {previa.paragrafosDepois.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              <p className="text-right">{previa.fecho}</p>
              <p className="text-center">{previa.assinatura.join(" · ")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => gerar.mutate()}
                disabled={
                  gerar.isPending ||
                  faltantes.length > 0 ||
                  caso.status === "encerrado" ||
                  previa.tabela.length === 0
                }
              >
                {gerar.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1 h-4 w-4" />
                )}
                Gerar notificação (PDF)
              </Button>
              {caso.notificacao_gerada_em && (
                <span className="text-xs text-muted-foreground">
                  Primeira emissão em {formatarDataBR(caso.notificacao_gerada_em.slice(0, 10))}.
                  Reemitir não altera essa data.
                </span>
              )}
            </div>
          </section>

          <RegistrarEnvioNotificacao
            casoId={caso.id}
            status={caso.status}
            prazoFinal={caso.prazo_final}
            onDone={() => debitoAtual.refetch()}
          />
        </>
      )}
    </div>
  );
}

export function RegistrarEnvioNotificacao({
  casoId,
  status,
  prazoFinal,
  onDone,
}: {
  casoId: string;
  status: StatusCaso;
  prazoFinal: string | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const assinar = useServerFn(assinarUploadCobranca);
  const registrar = useServerFn(registrarEnvioNotificacao);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [print, setPrint] = useState<File | null>(null);
  const [recebidaEm, setRecebidaEm] = useState(hojeYMD());

  const enviar = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error("Envie o arquivo da notificação enviada.");
      if (!print) throw new Error("Envie o print do envio.");
      if (!recebidaEm) throw new Error("Informe a data de recebimento.");
      const notificacao = await enviarArquivoCobranca(assinar, casoId, arquivo, arquivo.name);
      const printEnviado = await enviarArquivoCobranca(assinar, casoId, print, print.name);
      return registrar({ data: { casoId, notificacao, print: printEnviado, recebidaEm } });
    },
    onSuccess: (r) => {
      toast.success(`Envio registrado. Prazo final: ${formatarDataBR(r.prazo_final)}.`);
      setArquivo(null);
      setPrint(null);
      qc.invalidateQueries({ queryKey: ["cobranca_caso", casoId] });
      qc.invalidateQueries({ queryKey: ["cobranca_casos"] });
      qc.invalidateQueries({ queryKey: ["cobranca_debito_atual", casoId] });
      qc.invalidateQueries({ queryKey: ["cobranca_casos_notificacao"] });
      onDone?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao registrar o envio."),
  });

  if (status !== "notificacao") {
    return (
      <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {status === "aguardando_prazo" && prazoFinal
          ? `Envio da notificação já registrado. Prazo final: ${formatarDataBR(prazoFinal)}.`
          : status === "mensagens"
            ? "O envio da notificação só pode ser registrado após as 5 mensagens."
            : "Este caso já passou da etapa de notificação."}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Send className="h-4 w-4" /> Registrar envio da notificação
      </h3>
      <p className="text-xs text-muted-foreground">
        Anexe o arquivo enviado ao responsável e o print do envio. O prazo de 10 dias corridos conta
        a partir da data de recebimento.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">
            Notificação enviada (PDF/imagem)
          </Label>
          <Input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Print do envio</Label>
          <Input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setPrint(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Data de recebimento</Label>
          <Input
            type="date"
            value={recebidaEm}
            max={hojeYMD()}
            onChange={(e) => setRecebidaEm(e.target.value)}
          />
        </div>
      </div>
      <Button onClick={() => enviar.mutate()} disabled={enviar.isPending || !arquivo || !print}>
        {enviar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Registrar envio
      </Button>
      <p className="text-xs text-muted-foreground">
        Após o registro, o caso passa a "Aguardando prazo".
      </p>
    </section>
  );
}
