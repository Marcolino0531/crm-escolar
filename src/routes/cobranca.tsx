import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  HandCoins,
  RefreshCw,
  CheckCircle2,
  Clock,
  Users,
  MessageCircle,
  Gavel,
  FileText,
  CalendarCheck,
  AlertTriangle,
} from "lucide-react";
import { useSchool, usePermissions, useAuth } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSponteInadimplencia,
  fetchResponsavelCobranca,
  type PendenciaAgrupada,
  type ResponsavelCobranca,
} from "@/lib/sponte.functions";
import { parseISODateLocal, formatDateBR, monthKeyFromISO, todayISOLocal } from "@/lib/date-utils";

export const Route = createFileRoute("/cobranca")({
  head: () => ({ meta: [{ title: "Cobrança — School Hub" }] }),
  component: CobrancaGate,
});

// VISIBILIDADE (DEFAULT DENY + cadeia): a rota é bloqueada por padrão. Só
// renderiza quando o Administrador concede acesso à macro "financeiro" E ao
// submódulo "financeiro_cobranca".
function CobrancaGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro") || !canView("financeiro_cobranca"))
    return <AccessDenied message="Você não tem permissão para acessar a Cobrança." />;
  return <CobrancaPage />;
}

const UNIDADES_SPONTE = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

// Régua de cobrança: primeiro alerta em D+2 (poupa o D+1 para o arquivo retorno),
// depois a cada 2 dias até D+30. Em D+30 a régua regular é interrompida e o caso
// migra para a fase extrajudicial (pré-judicial).
const TICK_INICIAL = 2;
const TICK_FINAL = 30;

function formatarMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function vencToYMD(v: string): string {
  if (!v) return "";
  if (v.includes("/")) {
    const [d, m, y] = v.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return v.slice(0, 10);
}

function diasDeAtraso(vencYMD: string, hojeYMD: string): number {
  const a = parseISODateLocal(vencYMD);
  const b = parseISODateLocal(hojeYMD);
  if (!a || !b) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

// Dias do ciclo já "vencidos" (deveriam ter sido cobrados) dado o atraso atual.
function ticksDevidos(diasAtraso: number): number[] {
  const ticks: number[] = [];
  for (let d = TICK_INICIAL; d <= Math.min(diasAtraso, TICK_FINAL); d += 2) ticks.push(d);
  return ticks;
}

// Todos os marcos do ciclo (2..30) para desenhar a linha do tempo completa.
const TODOS_TICKS: number[] = (() => {
  const arr: number[] = [];
  for (let d = TICK_INICIAL; d <= TICK_FINAL; d += 2) arr.push(d);
  return arr;
})();

function formatarTelefoneWhatsApp(telefone: string): string {
  const nums = telefone.replace(/\D/g, "");
  return nums.startsWith("55") ? nums : `55${nums}`;
}

function iniciais(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type EnvioRow = {
  perfil_key: string;
  competencia: string;
  tick_dia: number;
  canal: string;
};

type PerfilCobranca = {
  perfilKey: string;
  nomeResponsavel: string;
  telefone: string;
  unidade: string;
  alunos: string[];
  alunoIdPrincipal: string;
  boletos: PendenciaAgrupada[];
  valorTotal: number;
  maxDiasAtraso: number;
  competencia: string; // YYYY-MM-01 do boleto mais atrasado
};

function CobrancaPage() {
  const { selected, schools } = useSchool();
  const { session } = useAuth();
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("financeiro_cobranca");
  const qc = useQueryClient();
  const fetchFn = useServerFn(fetchSponteInadimplencia);
  const fetchRespFn = useServerFn(fetchResponsavelCobranca);

  const hojeYMD = todayISOLocal();
  const competenciaAtual = monthKeyFromISO(hojeYMD);

  // Janela de busca: ANO CORRENTE (01/01 → hoje). Visão total de quem está
  // devendo no ano — inclui casos de longo atraso (30/60/90+ dias), não só os
  // recentes. A busca anual é mais lenta no Sponte, então a UI usa skeleton.
  const janela = useMemo(() => {
    const fim = parseISODateLocal(hojeYMD)!;
    return { inicio: `${fim.getFullYear()}-01-01`, fim: hojeYMD };
  }, [hojeYMD]);

  const unidadeNome =
    selected === "all" ? null : (schools.find((s) => s.id === selected)?.name ?? null);
  const integracaoDisponivel = unidadeNome === null || UNIDADES_SPONTE.includes(unidadeNome);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["cobranca-sponte", janela.inicio, janela.fim, unidadeNome ?? "consolidado"],
    enabled: integracaoDisponivel,
    staleTime: 60_000,
    queryFn: () =>
      fetchFn({ data: { dataInicio: janela.inicio, dataFim: janela.fim, unidade: unidadeNome ?? undefined } }),
  });

  const serverError = data?.error ?? null;

  // ── Perfis de cobrança (agrupados por Responsável Financeiro) ──────────────
  const perfis = useMemo<PerfilCobranca[]>(() => {
    const pend = (data?.pendencias ?? []).filter((p) => {
      const venc = vencToYMD(p.vencimento);
      return venc && venc < hojeYMD; // somente vencidos
    });
    const map = new Map<string, PerfilCobranca>();
    for (const p of pend) {
      const unidade = p.unidade ?? "—";
      const key = `${unidade}::${p.nomeResponsavel}`;
      const venc = vencToYMD(p.vencimento);
      const atraso = diasDeAtraso(venc, hojeYMD);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          perfilKey: key,
          nomeResponsavel: p.nomeResponsavel,
          telefone: p.telefone,
          unidade,
          alunos: [p.nomeAluno].filter(Boolean),
          alunoIdPrincipal: p.alunoId,
          boletos: [p],
          valorTotal: p.valorTotalBoleto,
          maxDiasAtraso: atraso,
          competencia: monthKeyFromISO(venc),
        });
      } else {
        if (p.nomeAluno && !existing.alunos.includes(p.nomeAluno)) existing.alunos.push(p.nomeAluno);
        existing.boletos.push(p);
        existing.valorTotal += p.valorTotalBoleto;
        if (atraso > existing.maxDiasAtraso) {
          existing.maxDiasAtraso = atraso;
          existing.competencia = monthKeyFromISO(venc);
          existing.alunoIdPrincipal = p.alunoId;
        }
      }
    }
    return [...map.values()].sort((a, b) => b.maxDiasAtraso - a.maxDiasAtraso);
  }, [data, hojeYMD]);

  // ── Checklist operacional do mês ───────────────────────────────────────────
  const { data: checklist } = useQuery({
    queryKey: ["cobranca-checklist", competenciaAtual],
    queryFn: async () => {
      const { data: row } = await supabase
        .from("cobranca_checklist" as never)
        .select("*")
        .eq("competencia", competenciaAtual)
        .maybeSingle();
      return (row ?? null) as { boletos_enviados: boolean; marcado_em: string | null } | null;
    },
  });
  const boletosEnviados = !!checklist?.boletos_enviados;

  const toggleChecklist = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await supabase.from("cobranca_checklist" as never).upsert(
        {
          competencia: competenciaAtual,
          boletos_enviados: value,
          marcado_por: session?.user?.id ?? null,
          marcado_em: value ? new Date().toISOString() : null,
        } as never,
        { onConflict: "competencia" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cobranca-checklist", competenciaAtual] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar o checklist."),
  });

  // ── Histórico de envios (régua + extrajudicial) ────────────────────────────
  const { data: enviosData } = useQuery({
    queryKey: ["cobranca-envios"],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("cobranca_envios" as never)
        .select("perfil_key, competencia, tick_dia, canal");
      return (rows ?? []) as unknown as EnvioRow[];
    },
  });

  const enviosSet = useMemo(() => {
    const s = new Set<string>();
    for (const e of enviosData ?? []) {
      const comp = String(e.competencia).slice(0, 10);
      s.add(`${e.perfil_key}|${comp}|${e.tick_dia}|${e.canal}`);
    }
    return s;
  }, [enviosData]);

  const registrarEnvio = useMutation({
    mutationFn: async (args: {
      perfil: PerfilCobranca;
      tickDia: number;
      canal: "regua" | "extrajudicial";
    }) => {
      const { perfil, tickDia, canal } = args;
      const { error } = await supabase.from("cobranca_envios" as never).insert(
        {
          perfil_key: perfil.perfilKey,
          aluno_id: perfil.alunoIdPrincipal,
          responsavel_nome: perfil.nomeResponsavel,
          competencia: perfil.competencia,
          tick_dia: tickDia,
          canal,
          enviado_por: session?.user?.id ?? null,
        } as never,
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cobranca-envios"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao registrar o envio."),
  });

  // ── Notificação Extrajudicial (D+30): puxa dados do Sponte e gera o PDF ─────
  const [gerandoKey, setGerandoKey] = useState<string | null>(null);
  async function gerarExtrajudicial(perfil: PerfilCobranca) {
    setGerandoKey(perfil.perfilKey);
    try {
      const resp = await fetchRespFn({
        data: { alunoId: perfil.alunoIdPrincipal, unidade: perfil.unidade },
      });
      if (resp.error) {
        toast.error(resp.error);
        return;
      }
      abrirDocumentoExtrajudicial(perfil, resp);
      if (podeEditar) {
        registrarEnvio.mutate({ perfil, tickDia: TICK_FINAL, canal: "extrajudicial" });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar a notificação.");
    } finally {
      setGerandoKey(null);
    }
  }

  if (!integracaoDisponivel) {
    return (
      <div className="space-y-6">
        <CabecalhoCobranca onRefresh={() => refetch()} isFetching={isFetching} />
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          A unidade selecionada não possui integração com o Sponte.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CabecalhoCobranca onRefresh={() => refetch()} isFetching={isFetching} />

      {/* Card de Checklist Operacional do Mês */}
      <ChecklistCard
        competencia={competenciaAtual}
        boletosEnviados={boletosEnviados}
        marcadoEm={checklist?.marcado_em ?? null}
        podeEditar={podeEditar}
        saving={toggleChecklist.isPending}
        onToggle={(v) => toggleChecklist.mutate(v)}
      />

      {serverError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverError}
        </div>
      )}

      {/* Lista de inadimplentes em formato de "Cards de Perfil" (estilo Netflix) */}
      {isFetching && perfis.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full rounded-xl" />
          ))}
        </div>
      ) : perfis.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-3 text-sm font-medium">Nenhum inadimplente no período.</p>
          <p className="text-xs text-muted-foreground">
            Não há boletos vencidos na janela monitorada.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {perfis.map((perfil) => (
            <PerfilCard
              key={perfil.perfilKey}
              perfil={perfil}
              enviosSet={enviosSet}
              podeEditar={podeEditar}
              registrando={registrarEnvio.isPending}
              gerando={gerandoKey === perfil.perfilKey}
              onRegistrar={(tickDia) =>
                registrarEnvio.mutate({ perfil, tickDia, canal: "regua" })
              }
              onExtrajudicial={() => gerarExtrajudicial(perfil)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CabecalhoCobranca({
  onRefresh,
  isFetching,
}: {
  onRefresh: () => void;
  isFetching: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <HandCoins className="h-5 w-5 text-primary" /> Cobrança
        </h1>
        <p className="text-sm text-muted-foreground">
          Régua de cobrança automática (D+2, a cada 2 dias até D+30) e notificação extrajudicial.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching}>
        <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
      </Button>
    </div>
  );
}

function ChecklistCard({
  competencia,
  boletosEnviados,
  marcadoEm,
  podeEditar,
  saving,
  onToggle,
}: {
  competencia: string;
  boletosEnviados: boolean;
  marcadoEm: string | null;
  podeEditar: boolean;
  saving: boolean;
  onToggle: (v: boolean) => void;
}) {
  const mesLabel = (() => {
    const d = parseISODateLocal(competencia);
    if (!d) return "";
    return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  })();
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <CalendarCheck className="h-4 w-4" /> Checklist Operacional · {mesLabel}
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="h-5 w-5 rounded border-border accent-primary disabled:opacity-50"
          checked={boletosEnviados}
          disabled={!podeEditar || saving}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="text-sm font-medium">Boletos de Mensalidade Enviados</span>
        {boletosEnviados && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Concluído
          </span>
        )}
      </label>
      {boletosEnviados && marcadoEm && (
        <p className="mt-1 pl-8 text-[11px] text-muted-foreground">
          Marcado em {formatDateBR(marcadoEm.slice(0, 10))}.
        </p>
      )}
      {!boletosEnviados && (
        <p className="mt-1 pl-8 text-[11px] text-amber-600">
          Lembrete: enviar os boletos de todos os colégios até o dia 25.
        </p>
      )}
    </div>
  );
}

function PerfilCard({
  perfil,
  enviosSet,
  podeEditar,
  registrando,
  gerando,
  onRegistrar,
  onExtrajudicial,
}: {
  perfil: PerfilCobranca;
  enviosSet: Set<string>;
  podeEditar: boolean;
  registrando: boolean;
  gerando: boolean;
  onRegistrar: (tickDia: number) => void;
  onExtrajudicial: () => void;
}) {
  const atraso = perfil.maxDiasAtraso;
  const fase: "grace" | "regua" | "juridica" =
    atraso >= TICK_FINAL ? "juridica" : atraso >= TICK_INICIAL ? "regua" : "grace";
  const devidos = ticksDevidos(atraso);
  const proximoPendente = devidos.find(
    (t) => !enviosSet.has(`${perfil.perfilKey}|${perfil.competencia}|${t}|regua`),
  );

  const tagAtraso =
    atraso >= TICK_FINAL
      ? "bg-red-600 text-white"
      : atraso >= 10
        ? "bg-amber-500 text-white"
        : "bg-yellow-100 text-yellow-800";

  const whatsappLink = (() => {
    const numero = formatarTelefoneWhatsApp(perfil.telefone);
    const msg = encodeURIComponent(
      `Olá, aqui é do setor financeiro do colégio. Identificamos pendência(s) em aberto no valor de ${formatarMoeda(perfil.valorTotal)}. Poderia, por favor, regularizar? Estamos à disposição.`,
    );
    return `https://wa.me/${numero}?text=${msg}`;
  })();

  return (
    <div
      className={`flex flex-col rounded-xl border bg-card p-4 transition-shadow hover:shadow-md ${
        fase === "juridica" ? "border-2 border-red-500" : "border-border"
      }`}
    >
      {/* Perfil principal: Responsável Financeiro */}
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
          {iniciais(perfil.nomeResponsavel)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold" title={perfil.nomeResponsavel}>
            {perfil.nomeResponsavel || "Responsável não identificado"}
          </div>
          <div className="text-[11px] text-muted-foreground">{perfil.unidade}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${tagAtraso}`}>
          {atraso} {atraso === 1 ? "dia" : "dias"}
        </span>
      </div>

      {/* Sub-perfis vinculados: alunos (irmãos) */}
      <div className="mt-3 flex items-center gap-2">
        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="flex flex-wrap gap-1.5">
          {perfil.alunos.map((aluno) => (
            <span
              key={aluno}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium"
              title={aluno}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[8px] font-bold text-primary">
                {iniciais(aluno)}
              </span>
              {aluno}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 text-sm">
        <span className="text-muted-foreground">Total em aberto: </span>
        <span className="font-semibold text-red-600">{formatarMoeda(perfil.valorTotal)}</span>
        <span className="text-[11px] text-muted-foreground">
          {" "}
          · {perfil.boletos.length} boleto(s)
        </span>
      </div>

      {/* Linha do tempo da régua (D+2..D+30). NUNCA é resetada nem escondida:
          permanece sempre visível, inclusive após 30/60/90+ dias de atraso,
          preservando o histórico da cobrança amigável como prova (ação líquida
          e certa). Em casos de longo atraso, todo o ciclo D+2→D+30 fica marcado. */}
      <div className="mt-3">
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">
          Régua de cobrança
        </div>
        <div className="flex flex-wrap gap-1">
          {TODOS_TICKS.map((t) => {
            const enviado = enviosSet.has(`${perfil.perfilKey}|${perfil.competencia}|${t}|regua`);
            const devido = devidos.includes(t);
            const estado = enviado ? "enviado" : devido ? "pendente" : "futuro";
            const cls =
              estado === "enviado"
                ? "bg-emerald-500 text-white"
                : estado === "pendente"
                  ? "bg-amber-100 text-amber-700 ring-1 ring-amber-400"
                  : "bg-muted text-muted-foreground/60";
            return (
              <span
                key={t}
                title={`D+${t} — ${estado}`}
                className={`flex h-6 w-6 items-center justify-center rounded text-[10px] font-semibold ${cls}`}
              >
                {t}
              </span>
            );
          })}
        </div>
        {fase === "juridica" && (
          <p className="mt-1 text-[10px] font-medium text-red-600">
            Ciclo amigável concluído (D+2 → D+30). Histórico mantido para fins legais.
          </p>
        )}
      </div>

      {/* Ações */}
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
        >
          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
        </a>
        {podeEditar && fase === "regua" && proximoPendente && (
          <Button
            size="sm"
            variant="outline"
            className="h-auto py-1.5 text-xs"
            disabled={registrando}
            onClick={() => onRegistrar(proximoPendente)}
          >
            <Clock className="mr-1.5 h-3.5 w-3.5" /> Registrar cobrança (D+{proximoPendente})
          </Button>
        )}
        {fase === "juridica" && (
          <Button
            size="sm"
            className="h-auto bg-red-600 py-1.5 text-xs hover:bg-red-700"
            disabled={gerando}
            onClick={onExtrajudicial}
          >
            {gerando ? (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="mr-1.5 h-3.5 w-3.5" />
            )}
            Notificação Extrajudicial (PDF)
          </Button>
        )}
      </div>

      {fase === "juridica" && (
        <div className="mt-3 flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">
          <Gavel className="h-3.5 w-3.5" /> Fase Jurídica / Extrajudicial
        </div>
      )}
      {fase === "grace" && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Aguardando D+2 (arquivo retorno do banco)
        </div>
      )}
    </div>
  );
}

// Monta e abre o documento de Notificação Extrajudicial em uma nova janela,
// pronta para "Salvar como PDF" / imprimir.
function abrirDocumentoExtrajudicial(perfil: PerfilCobranca, resp: ResponsavelCobranca) {
  const enderecoCompleto = [
    [resp.endereco, resp.numero].filter(Boolean).join(", "),
    resp.complemento,
    resp.bairro,
    [resp.cidade, resp.estado].filter(Boolean).join(" - "),
    resp.cep ? `CEP ${resp.cep}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const hojeFmt = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const linhas = perfil.boletos
    .map((b) => {
      const venc = vencToYMD(b.vencimento);
      return `<tr>
        <td>${(b.categorias ?? []).join(", ") || "Mensalidade/Taxas"}</td>
        <td>${formatDateBR(venc)}</td>
        <td style="text-align:right">${formatarMoeda(b.valorTotalBoleto)}</td>
      </tr>`;
    })
    .join("");

  const esc = (s: string) => (s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Notificação Extrajudicial - ${esc(resp.nomeResponsavel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; max-width: 760px; margin: 40px auto; padding: 0 32px; line-height: 1.6; }
  h1 { text-align: center; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; }
  .meta { margin: 24px 0; font-size: 14px; }
  .meta strong { display: inline-block; min-width: 120px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th, td { border: 1px solid #999; padding: 6px 8px; }
  th { background: #f0f0f0; text-align: left; }
  .total { text-align: right; font-weight: bold; font-size: 15px; margin-top: 8px; }
  p { font-size: 14px; text-align: justify; }
  .assinatura { margin-top: 56px; text-align: center; font-size: 14px; }
  .hr { border-top: 1px solid #333; width: 280px; margin: 48px auto 4px; }
  @media print { body { margin: 0; } }
</style></head>
<body onload="window.print()">
  <h1>Notificação Extrajudicial<br/>(Comunicação Pré-Judicial de Débito)</h1>
  <div class="meta">
    <div><strong>Notificado(a):</strong> ${esc(resp.nomeResponsavel) || "—"}</div>
    <div><strong>CPF:</strong> ${esc(resp.cpf) || "—"}</div>
    <div><strong>Endereço:</strong> ${esc(enderecoCompleto) || "—"}</div>
    <div><strong>Aluno(s):</strong> ${esc(perfil.alunos.join(", ")) || "—"}</div>
    <div><strong>Unidade:</strong> ${esc(perfil.unidade)}</div>
  </div>
  <p>Prezado(a) Senhor(a),</p>
  <p>
    Vimos, por meio da presente, notificá-lo(a) extrajudicialmente acerca da
    existência de débito(s) em aberto referente(s) a serviços educacionais
    prestados, conforme discriminado abaixo. Até a presente data, constam em nossos
    registros as seguintes pendências financeiras vencidas há mais de 30 (trinta)
    dias:
  </p>
  <table>
    <thead><tr><th>Descrição</th><th>Vencimento</th><th>Valor</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>
  <div class="total">Total em aberto: ${formatarMoeda(perfil.valorTotal)}</div>
  <p>
    Solicitamos a regularização do(s) valor(es) acima no prazo improrrogável de
    <strong>05 (cinco) dias úteis</strong> a contar do recebimento desta. O não
    atendimento ensejará a adoção das medidas cabíveis para a cobrança do crédito,
    incluindo a inscrição nos órgãos de proteção ao crédito e o ajuizamento da ação
    competente, com os acréscimos legais (juros, correção e honorários).
  </p>
  <p>
    Caso o pagamento já tenha sido efetuado, favor desconsiderar esta comunicação e
    nos encaminhar o respectivo comprovante.
  </p>
  <div class="assinatura">
    <div>${hojeFmt}</div>
    <div class="hr"></div>
    <div>Setor Financeiro — ${esc(perfil.unidade)}</div>
  </div>
</body></html>`;

  const win = window.open("", "_blank", "width=820,height=900");
  if (!win) {
    toast.error("Permita pop-ups para gerar o PDF da notificação.");
    return;
  }
  win.document.write(html);
  win.document.close();
}
