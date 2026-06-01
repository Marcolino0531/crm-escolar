import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  RefreshCw,
  MessageCircle,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronUp,
  PartyPopper,
  SearchX,
  Users,
  FileText,
  Clock,
  Building2,
  Construction,
} from "lucide-react";
import { useSchool } from "@/lib/app-context";
import { fetchSponteInadimplencia, type PendenciaAgrupada } from "@/lib/sponte.functions";

export const Route = createFileRoute("/inadimplencia")({
  head: () => ({ meta: [{ title: "Inadimplência (Sponte) — Schooler Hub" }] }),
  component: InadimplenciaPage,
});

// Unidades com integração Sponte ativa (token/código 23568 atende só CEC e CEC Baby).
const UNIDADES_SPONTE = ["CEC", "CEC Baby"];

function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarTelefoneWhatsApp(telefone: string): string {
  const nums = telefone.replace(/\D/g, "");
  if (nums.startsWith("55")) return nums;
  return `55${nums}`;
}

function gerarLinkWhatsApp(telefone: string, nomeAluno: string, valorTotal: number): string {
  const numero = formatarTelefoneWhatsApp(telefone);
  const valorFormatado = formatarMoeda(valorTotal);
  const mensagem = encodeURIComponent(
    `Olá, aqui é do setor financeiro do colégio. Notamos uma pendência referente ao aluno ${nomeAluno} no valor de ${valorFormatado}. Como podemos ajudar?`,
  );
  return `https://wa.me/${numero}?text=${mensagem}`;
}

function formatarData(data: string): string {
  if (!data) return "-";
  if (data.includes("/")) return data;
  if (data.includes("-")) {
    const [y, m, d] = data.split("-");
    return `${d}/${m}/${y}`;
  }
  return data;
}

function formatDateBR(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function calcDiffDays(inicio: string, fim: string): number {
  const d1 = new Date(inicio);
  const d2 = new Date(fim);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function getPeriodoLabel(inicio: string, fim: string): string {
  const hoje = new Date().toISOString().split("T")[0];
  const diff = calcDiffDays(inicio, fim);
  if (fim === hoje && diff === 30) return "Últimos 30 dias";
  if (fim === hoje && diff === 60) return "Últimos 60 dias";
  if (fim === hoje && diff === 90) return "Últimos 90 dias";
  return `${formatDateBR(inicio)} — ${formatDateBR(fim)} (${diff} dias)`;
}

function getDefaultDateRange(): { inicio: string; fim: string } {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - 30);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { inicio: fmt(inicio), fim: fmt(hoje) };
}

type SortField = keyof PendenciaAgrupada;

function InadimplenciaPage() {
  const { selected, schools } = useSchool();
  const fetchFn = useServerFn(fetchSponteInadimplencia);
  const defaultRange = getDefaultDateRange();

  const [dataInicio, setDataInicio] = useState(defaultRange.inicio);
  const [dataFim, setDataFim] = useState(defaultRange.fim);
  const [tempInicio, setTempInicio] = useState(defaultRange.inicio);
  const [tempFim, setTempFim] = useState(defaultRange.fim);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [ordenacao, setOrdenacao] = useState<{ campo: SortField; direcao: "asc" | "desc" }>({
    campo: "valorTotalBoleto",
    direcao: "desc",
  });

  // Mapeia o seletor de Unidade (school_id) para a unidade do Sponte.
  const unidadeNome =
    selected === "all" ? null : (schools.find((s) => s.id === selected)?.name ?? null);
  const integracaoDisponivel = unidadeNome === null || UNIDADES_SPONTE.includes(unidadeNome);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["sponte-inadimplencia", dataInicio, dataFim, unidadeNome ?? "consolidado"],
    enabled: integracaoDisponivel,
    staleTime: 60_000,
    queryFn: () =>
      fetchFn({
        data: { dataInicio, dataFim, unidade: unidadeNome ?? undefined },
      }),
  });

  const pendencias = useMemo(() => data?.pendencias ?? [], [data]);
  const meta = data?.meta ?? null;
  const serverError = data?.error ?? (error instanceof Error ? error.message : null);

  const toggleOrdenacao = (campo: SortField) => {
    setOrdenacao((prev) =>
      prev.campo === campo
        ? { campo, direcao: prev.direcao === "asc" ? "desc" : "asc" }
        : { campo, direcao: "desc" },
    );
  };

  const aplicarPeriodo = (dias: number) => {
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - dias);
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    setDataInicio(fmt(inicio));
    setDataFim(fmt(hoje));
    setShowDatePicker(false);
  };

  const aplicarPeriodoCustom = () => {
    const diffDays = calcDiffDays(tempInicio, tempFim);
    if (diffDays > 90) {
      alert("Selecione um período de no máximo 90 dias para garantir a performance.");
      return;
    }
    if (diffDays < 0) {
      alert("A data inicial deve ser anterior à data final.");
      return;
    }
    setDataInicio(tempInicio);
    setDataFim(tempFim);
    setShowDatePicker(false);
  };

  const pendenciasFiltradas = useMemo(() => {
    return pendencias
      .filter((p) => {
        if (!filtro) return true;
        const termo = filtro.toLowerCase();
        return (
          p.nomeAluno.toLowerCase().includes(termo) ||
          p.nomeResponsavel.toLowerCase().includes(termo) ||
          p.telefone.includes(termo)
        );
      })
      .sort((a, b) => {
        const dir = ordenacao.direcao === "asc" ? 1 : -1;
        const valA = a[ordenacao.campo];
        const valB = b[ordenacao.campo];
        if (typeof valA === "number" && typeof valB === "number") return (valA - valB) * dir;
        return String(valA).localeCompare(String(valB)) * dir;
      });
  }, [pendencias, filtro, ordenacao]);

  const totalPendente = pendenciasFiltradas.reduce((sum, p) => sum + p.valorTotalBoleto, 0);
  const periodoLabel = getPeriodoLabel(dataInicio, dataFim);

  const SortIcon = ({ campo }: { campo: SortField }) => {
    if (ordenacao.campo !== campo) return <ChevronDown size={14} className="opacity-30" />;
    return ordenacao.direcao === "asc" ? (
      <ChevronUp size={14} className="text-indigo-600" />
    ) : (
      <ChevronDown size={14} className="text-indigo-600" />
    );
  };

  if (!integracaoDisponivel) {
    return (
      <div className="p-2">
        <div className="rounded-xl border border-border bg-card p-12">
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-amber-100 p-4">
              <Construction size={40} className="text-amber-500" />
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-600">
              <Building2 size={16} />
              {unidadeNome}
            </div>
            <h2 className="text-xl font-bold text-foreground">Integração em breve</h2>
            <p className="text-muted-foreground">
              A integração com o Sponte para esta unidade estará disponível em breve.
            </p>
            <p className="text-xs text-muted-foreground">
              Selecione <strong>CEC</strong> ou <strong>CEC Baby</strong> no menu superior para
              visualizar as cobranças ativas.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileText size={14} /> Boletos em Aberto
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {meta?.totalBoletos ?? 0}
            {meta && meta.totalParcelas !== meta.totalBoletos && (
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                ({meta.totalParcelas} parcelas)
              </span>
            )}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Users size={14} /> Alunos com Pendência
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">{meta?.alunosComPendencia ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <AlertTriangle size={14} /> Total Pendente
          </div>
          <p className="mt-1 text-2xl font-bold text-red-600">{formatarMoeda(totalPendente)}</p>
        </div>
      </div>

      {/* Period selector */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-700">
            <Clock size={16} />
            {periodoLabel}
            {unidadeNome && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
                <Building2 size={12} /> {unidadeNome}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[30, 60, 90].map((dias) => {
              const ativo = periodoLabel === `Últimos ${dias} dias`;
              return (
                <button
                  key={dias}
                  onClick={() => aplicarPeriodo(dias)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    ativo
                      ? "bg-indigo-600 text-white"
                      : "border border-indigo-300 bg-white text-indigo-600 hover:bg-indigo-100"
                  }`}
                >
                  {dias} dias
                </button>
              );
            })}
            <button
              onClick={() => {
                setTempInicio(dataInicio);
                setTempFim(dataFim);
                setShowDatePicker(!showDatePicker);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                showDatePicker
                  ? "bg-indigo-600 text-white"
                  : "border border-indigo-300 bg-white text-indigo-600 hover:bg-indigo-100"
              }`}
            >
              Personalizar
            </button>
          </div>
        </div>

        {showDatePicker && (
          <div className="mt-3 flex flex-col items-start gap-3 border-t border-indigo-200 pt-3 sm:flex-row sm:items-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-indigo-700">Data Inicial</label>
              <input
                type="date"
                value={tempInicio}
                onChange={(e) => setTempInicio(e.target.value)}
                className="rounded-lg border border-indigo-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-indigo-700">Data Final</label>
              <input
                type="date"
                value={tempFim}
                onChange={(e) => setTempFim(e.target.value)}
                className="rounded-lg border border-indigo-300 px-3 py-1.5 text-sm"
              />
            </div>
            <button
              onClick={aplicarPeriodoCustom}
              disabled={isFetching}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Search size={14} /> Buscar Período
            </button>
            <p className="text-xs text-indigo-500">Máximo: 90 dias por consulta</p>
          </div>
        )}
      </div>

      {/* Actions bar */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-md flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar por aluno, responsável ou telefone..."
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
            {isFetching ? "Buscando..." : "Atualizar Dados"}
          </button>
        </div>
      </div>

      {/* Error */}
      {serverError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-medium text-red-800">Erro na integração Sponte</p>
            <p className="mt-1 text-sm text-red-600">{serverError}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th
                  onClick={() => toggleOrdenacao("nomeAluno")}
                  className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted"
                >
                  <div className="flex items-center gap-1">
                    Aluno <SortIcon campo="nomeAluno" />
                  </div>
                </th>
                <th
                  onClick={() => toggleOrdenacao("nomeResponsavel")}
                  className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted"
                >
                  <div className="flex items-center gap-1">
                    Responsável <SortIcon campo="nomeResponsavel" />
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Telefone
                </th>
                <th
                  onClick={() => toggleOrdenacao("vencimento")}
                  className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted"
                >
                  <div className="flex items-center gap-1">
                    Vencimento <SortIcon campo="vencimento" />
                  </div>
                </th>
                <th
                  onClick={() => toggleOrdenacao("valorTotalBoleto")}
                  className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted"
                >
                  <div className="flex items-center gap-1">
                    Valor Pendente <SortIcon campo="valorTotalBoleto" />
                  </div>
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isFetching && pendencias.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw size={32} className="animate-spin text-indigo-400" />
                      <p className="text-sm text-muted-foreground">
                        Consultando dados do Sponte...
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Buscando pendências de {formatDateBR(dataInicio)} a {formatDateBR(dataFim)}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : pendenciasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      {serverError ? (
                        <AlertTriangle size={40} className="text-amber-400" />
                      ) : filtro ? (
                        <SearchX size={40} className="text-muted-foreground/40" />
                      ) : (
                        <PartyPopper size={40} className="text-green-400" />
                      )}
                      <p className="text-sm font-medium text-muted-foreground">
                        {serverError
                          ? "Não foi possível carregar os dados"
                          : filtro
                            ? "Nenhum resultado encontrado para o filtro"
                            : `Nenhuma pendência financeira no período (${periodoLabel})`}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                pendenciasFiltradas.map((p, idx) => (
                  <tr key={`${p.groupKey}-${idx}`} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{p.nomeAluno}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.categorias.length > 0 ? p.categorias.join(", ") : "Parcela"}
                        {p.qtdParcelas > 1 && (
                          <span className="ml-1 text-indigo-500">({p.qtdParcelas} itens)</span>
                        )}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">{p.nomeResponsavel}</td>
                    <td className="px-4 py-3 font-mono text-sm text-foreground">{p.telefone}</td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {formatarData(p.vencimento)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-bold text-red-600">
                        {formatarMoeda(p.valorTotalBoleto)}
                      </span>
                      {p.descontoBolsa > 0 && (
                        <p className="mt-0.5 text-xs text-green-600">
                          ou {formatarMoeda(p.valorComDesconto)} c/ desc. {p.descontoBolsa}%
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {p.telefone && p.telefone !== "-" ? (
                        <a
                          href={gerarLinkWhatsApp(p.telefone, p.nomeAluno, p.valorTotalBoleto)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700"
                        >
                          <MessageCircle size={14} /> WhatsApp
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem telefone</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {meta && pendenciasFiltradas.length > 0 && (
          <div className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            {pendenciasFiltradas.length} boletos pendentes · consulta em {meta.tempoSegundos}s
          </div>
        )}
      </div>
    </div>
  );
}
