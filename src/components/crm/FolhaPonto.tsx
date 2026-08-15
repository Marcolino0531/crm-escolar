// Aba "Folha de Ponto" do RH: sobe o PDF mensal do relógio de ponto, confere
// página a página o funcionário identificado e gera os rankings de atraso e de
// saída antecipada da competência, com histórico por mês.
//
// Fonte de dados independente do ranking de faltas (lançamento manual diário):
// aqui tudo vem do arquivo.

import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Funcionario } from "@/lib/crm/types";
import {
  competenciaExtenso,
  detalheTecnicoErro,
  mensagemErroProcessamento,
} from "@/lib/contracheques";
import { ErroLeituraPdf } from "@/lib/contracheques.pdf";
import {
  LABEL_STATUS_PONTO,
  competenciaAnterior,
  competenciaFutura,
  conferirFolha,
  formatarMinutos,
  rankingAtrasos,
  rankingSaidasAntecipadas,
  resumirFolha,
  resumosProcessados,
  revincularPagina,
  type FuncionarioPonto,
  type LinhaRanking,
  type PaginaConferida,
  type PaginaPonto,
} from "@/lib/ponto";
import { lerFolhaDePonto } from "@/lib/ponto.pdf";
import { registrarFalhaPonto, salvarFolhaPonto } from "@/lib/ponto.functions";

type FolhaRow = {
  id: string;
  competencia: string;
  arquivo_nome: string;
  layout: string;
  tolerancia_min: number;
  total_paginas: number;
  paginas_processadas: number;
  paginas_sem_correspondencia: number;
  processado_em: string;
  processado_por_nome: string;
};

type EntradaRow = {
  id: string;
  timesheet_id: string;
  employee_nome: string;
  horario_entrada: string;
  horario_saida: string;
  dias_atraso: number;
  minutos_atraso: number;
  dias_saida_antecipada: number;
  minutos_saida_antecipada: number;
  dias_inconsistentes: number;
};

const LAYOUTS: Record<string, string> = {
  cartao_ponto: "Cartão de Ponto",
  iponto: "iPonto",
};

const CORES_STATUS: Record<PaginaConferida["status"], string> = {
  processada: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sem_correspondencia: "bg-red-50 text-red-700 border-red-200",
  sem_horario: "bg-amber-50 text-amber-700 border-amber-200",
  sem_dias: "bg-amber-50 text-amber-700 border-amber-200",
};

function paraPonto(f: Funcionario): FuncionarioPonto {
  return {
    id: f.id,
    nomeCompleto: f.nomeCompleto,
    cpf: f.cpf ?? "",
    unidade: f.unidade,
    ativo: !f.dataRescisao,
    horarioInicio: f.horarioTrabalhoInicio ?? "",
    horarioFim: f.horarioTrabalhoFim ?? "",
  };
}

const Ranking: React.FC<{ titulo: string; vazio: string; linhas: LinhaRanking[] }> = ({
  titulo,
  vazio,
  linhas,
}) => (
  <div className="bg-white border border-gray-200 rounded-2xl p-5">
    <h4 className="text-sm font-semibold text-gray-800">{titulo}</h4>
    {linhas.length === 0 ? (
      <p className="text-sm text-gray-500 mt-2">{vazio}</p>
    ) : (
      <table className="min-w-full text-sm mt-3">
        <thead>
          <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-3">#</th>
            <th className="py-2 pr-3">Funcionário</th>
            <th className="py-2 pr-3 text-right">Dias</th>
            <th className="py-2 pr-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={`${l.funcionarioId ?? l.nome}-${i}`} className="border-b border-gray-100">
              <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
              <td className="py-2 pr-3 text-gray-700">{l.nome}</td>
              <td className="py-2 pr-3 text-right text-gray-700">{l.dias}</td>
              <td className="py-2 pr-3 text-right font-medium text-gray-800">
                {formatarMinutos(l.minutos)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const FolhaPonto: React.FC<{ funcionarios: Funcionario[]; isAdmin: boolean }> = ({
  funcionarios,
  isAdmin,
}) => {
  const qc = useQueryClient();
  const salvarFn = useServerFn(salvarFolhaPonto);

  const [competencia, setCompetencia] = useState(competenciaAnterior());
  const [tolerancia, setTolerancia] = useState(0);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [paginasPdf, setPaginasPdf] = useState<PaginaPonto[]>([]);
  const [conferidas, setConferidas] = useState<PaginaConferida[] | null>(null);
  const [layout, setLayout] = useState<"cartao_ponto" | "iponto" | null>(null);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [senhaPdf, setSenhaPdf] = useState("");
  const [pedeSenha, setPedeSenha] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<number | null>(null);
  const [folhaHistorico, setFolhaHistorico] = useState<string | null>(null);

  const elenco = useMemo(() => funcionarios.map(paraPonto), [funcionarios]);
  const porId = useMemo(() => new Map(elenco.map((f) => [f.id, f])), [elenco]);

  const resumo = conferidas ? resumirFolha(conferidas) : null;
  const resumos = conferidas ? resumosProcessados(conferidas) : [];
  const atrasos = rankingAtrasos(resumos);
  const antecipadas = rankingSaidasAntecipadas(resumos);

  const folhas = useQuery({
    queryKey: ["hr-timesheets"],
    queryFn: async (): Promise<FolhaRow[]> => {
      const { data, error } = await supabase
        .from("hr_timesheets" as never)
        .select(
          "id, competencia, arquivo_nome, layout, tolerancia_min, total_paginas, paginas_processadas, paginas_sem_correspondencia, processado_em, processado_por_nome",
        )
        .order("competencia", { ascending: false })
        .limit(60);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as FolhaRow[];
    },
  });

  const entradas = useQuery({
    queryKey: ["hr-timesheet-entries", folhaHistorico],
    enabled: Boolean(folhaHistorico),
    queryFn: async (): Promise<EntradaRow[]> => {
      const { data, error } = await supabase
        .from("hr_timesheet_entries" as never)
        .select(
          "id, timesheet_id, employee_nome, horario_entrada, horario_saida, dias_atraso, minutos_atraso, dias_saida_antecipada, minutos_saida_antecipada, dias_inconsistentes",
        )
        .eq("timesheet_id", folhaHistorico ?? "")
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as EntradaRow[];
    },
  });

  const reportarFalha = (
    etapa: "leitura" | "calculo" | "gravacao",
    erro: unknown,
    file?: File | null,
  ) => {
    const d = detalheTecnicoErro(erro);
    void registrarFalhaPonto({
      data: {
        etapa,
        erroName: d.name,
        erroMessage: d.message,
        stack: d.stack || undefined,
        userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent.slice(0, 500),
        arquivoNome: file?.name,
        arquivoTamanho: file?.size,
      },
    }).catch(() => undefined);
  };

  const processarArquivo = async (file: File, senha: string) => {
    setLendo(true);
    setConferidas(null);
    setFalha(null);
    try {
      const lido = await lerFolhaDePonto(file, senha || undefined);
      setArquivo(file);
      setPedeSenha(false);
      setPaginasPdf(lido.paginas);
      setLayout(lido.layout);
      setConferidas(conferirFolha(lido.paginas, elenco, tolerancia));

      if (lido.paginasIgnoradas.length > 0) {
        toast.warning(
          `${lido.paginasIgnoradas.length} página(s) do PDF não puderam ser interpretadas ` +
            `(${lido.paginasIgnoradas.join(", ")}) e ficaram de fora do cálculo.`,
        );
      }
      if (lido.competenciaNoPdf && lido.competenciaNoPdf !== competencia) {
        toast.warning(
          `O período impresso no PDF é ${competenciaExtenso(lido.competenciaNoPdf)}, ` +
            `diferente da competência informada (${competenciaExtenso(competencia)}).`,
        );
      }
    } catch (err) {
      const mensagem = mensagemErroProcessamento(err);
      const precisaSenha =
        err instanceof ErroLeituraPdf &&
        (err.motivo === "senha" || err.motivo === "senha_incorreta");
      if (!(err instanceof ErroLeituraPdf)) reportarFalha("leitura", err, file);
      setFalha(mensagem);
      toast.error(mensagem);
      setPedeSenha(precisaSenha);
      setArquivo(precisaSenha ? file : null);
      if (!precisaSenha) {
        setPaginasPdf([]);
        setLayout(null);
      }
    } finally {
      setLendo(false);
    }
  };

  const handleArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Envie a folha de ponto em PDF.");
      return;
    }
    if (competenciaFutura(competencia)) {
      toast.error("A competência não pode ser um mês futuro.");
      return;
    }
    setSenhaPdf("");
    await processarArquivo(file, "");
  };

  // Tolerância muda o resultado de todo mundo: recalcula a conferência inteira
  // a partir das páginas já lidas, sem reler o arquivo.
  const aplicarTolerancia = (minutos: number) => {
    setTolerancia(minutos);
    if (paginasPdf.length > 0) setConferidas(conferirFolha(paginasPdf, elenco, minutos));
  };

  const limpar = () => {
    setArquivo(null);
    setPaginasPdf([]);
    setConferidas(null);
    setLayout(null);
    setSenhaPdf("");
    setPedeSenha(false);
    setFalha(null);
    setDetalhe(null);
  };

  const salvar = async () => {
    if (!conferidas || !layout || !resumo) return;
    const linhas = conferidas
      .filter((c) => c.status === "processada" && c.funcionarioId && c.esperado)
      .map((c) => ({
        employeeId: c.funcionarioId as string,
        horarioEntrada: c.esperado?.entrada ?? "",
        horarioSaida: c.esperado?.saida ?? "",
        diasAtraso: c.resumo.diasAtraso,
        minutosAtraso: c.resumo.minutosAtraso,
        diasSaidaAntecipada: c.resumo.diasAntecipacao,
        minutosSaidaAntecipada: c.resumo.minutosAntecipacao,
        diasAvaliados: c.resumo.diasAvaliados,
        diasInconsistentes: c.resumo.diasInconsistentes,
      }));
    if (linhas.length === 0) {
      toast.error("Nenhuma página foi vinculada a um funcionário com horário cadastrado.");
      return;
    }

    setSalvando(true);
    try {
      const res = await salvarFn({
        data: {
          competencia,
          arquivoNome: arquivo?.name ?? "",
          layout,
          toleranciaMin: tolerancia,
          totalPaginas: resumo.paginas,
          paginasSemCorrespondencia: resumo.semCorrespondencia,
          linhas,
        },
      });
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível salvar a folha.");
        return;
      }
      toast.success(
        res.substituiu
          ? `Folha de ${competenciaExtenso(competencia)} reprocessada (o resultado anterior foi substituído).`
          : `Folha de ${competenciaExtenso(competencia)} processada.`,
      );
      void qc.invalidateQueries({ queryKey: ["hr-timesheets"] });
      limpar();
    } catch (err) {
      reportarFalha("gravacao", err, arquivo);
      toast.error(mensagemErroProcessamento(err));
    } finally {
      setSalvando(false);
    }
  };

  const inputClass =
    "px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500";

  const historicoAtrasos: LinhaRanking[] = (entradas.data ?? [])
    .filter((e) => e.dias_atraso > 0)
    .map((e) => ({
      funcionarioId: e.id,
      nome: e.employee_nome,
      dias: e.dias_atraso,
      minutos: e.minutos_atraso,
    }))
    .sort((a, b) => b.minutos - a.minutos);

  const historicoAntecipadas: LinhaRanking[] = (entradas.data ?? [])
    .filter((e) => e.dias_saida_antecipada > 0)
    .map((e) => ({
      funcionarioId: e.id,
      nome: e.employee_nome,
      dias: e.dias_saida_antecipada,
      minutos: e.minutos_saida_antecipada,
    }))
    .sort((a, b) => b.minutos - a.minutos);

  return (
    <div className="space-y-8">
      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-gray-800">Folha de ponto mensal</h3>
        <p className="text-sm text-gray-500 mt-1">
          Suba o PDF do relógio de ponto (uma página por funcionário) e informe a competência —
          normalmente o mês anterior. O atraso e a saída antecipada são calculados contra o horário
          do cadastro de cada funcionário. Nada é gravado antes da sua confirmação.
        </p>

        <div className="flex flex-wrap items-end gap-4 mt-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Competência</label>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value || competenciaAnterior())}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Tolerância (minutos)
            </label>
            <input
              type="number"
              min={0}
              max={120}
              value={tolerancia}
              onChange={(e) => aplicarTolerancia(Math.max(0, Number(e.target.value) || 0))}
              className={`${inputClass} w-28`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              PDF da folha de ponto
            </label>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleArquivo}
              disabled={!isAdmin || lendo || salvando}
              className="block text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 disabled:opacity-50"
            />
          </div>
          {arquivo && (
            <button
              type="button"
              onClick={limpar}
              disabled={salvando}
              className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Descartar arquivo
            </button>
          )}
        </div>

        {!isAdmin && (
          <p className="text-sm text-amber-700 mt-3">
            Você tem acesso somente de leitura ao RH: o processamento é feito por quem tem permissão
            de edição.
          </p>
        )}
        {pedeSenha && arquivo && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border border-amber-200 bg-amber-50 rounded-xl p-3">
            <div>
              <label className="block text-xs font-medium text-amber-800 mb-1">
                Senha do PDF ({arquivo.name})
              </label>
              <input
                type="password"
                value={senhaPdf}
                onChange={(e) => setSenhaPdf(e.target.value)}
                placeholder="Senha de abertura do arquivo"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => void processarArquivo(arquivo, senhaPdf)}
              disabled={!senhaPdf.trim() || lendo}
              className="px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              Abrir PDF
            </button>
          </div>
        )}
        {falha && !lendo && <p className="text-sm text-red-600 mt-3">{falha}</p>}
        {lendo && <p className="text-sm text-gray-500 mt-3">Lendo a folha de ponto…</p>}
      </section>

      {conferidas && resumo && (
        <>
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-800">
                  Conferência — {competenciaExtenso(competencia)}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {resumo.paginas} página(s) · {resumo.processadas} processada(s) ·{" "}
                  {resumo.semCorrespondencia} sem correspondência · {resumo.semHorario} sem horário
                  cadastrado · {resumo.diasInconsistentes} dia(s) com marcação incompleta
                  {layout ? ` · formato ${LAYOUTS[layout] ?? layout}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void salvar()}
                disabled={!isAdmin || salvando || resumo.processadas === 0}
                className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-sm font-medium shadow-md disabled:opacity-50"
              >
                {salvando ? "Salvando…" : `Salvar folha de ${competenciaExtenso(competencia)}`}
              </button>
            </div>

            {resumo.horarioDivergente > 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-4">
                Em {resumo.horarioDivergente} página(s) o horário impresso no PDF é diferente do
                horário cadastrado no RH. O cálculo usa o cadastro — confira o horário do
                funcionário se o resultado parecer estranho.
              </p>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Pág.</th>
                    <th className="py-2 pr-3">No PDF</th>
                    <th className="py-2 pr-3">Funcionário</th>
                    <th className="py-2 pr-3">Horário (cadastro)</th>
                    <th className="py-2 pr-3 text-right">Atrasos</th>
                    <th className="py-2 pr-3 text-right">Saídas antec.</th>
                    <th className="py-2 pr-3">Situação</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {conferidas.map((c) => (
                    <React.Fragment key={c.pagina}>
                      <tr className="border-b border-gray-100">
                        <td className="py-2 pr-3 text-gray-700">{c.pagina}</td>
                        <td className="py-2 pr-3 text-gray-600">
                          {c.nomeNoPdf || "—"}
                          {c.origem === "nome" && (
                            <span className="ml-2 text-xs text-gray-400">nome aproximado</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={c.funcionarioId ?? ""}
                            onChange={(e) =>
                              setConferidas((atual) =>
                                atual
                                  ? revincularPagina(
                                      atual,
                                      paginasPdf,
                                      c.pagina,
                                      porId.get(e.target.value) ?? null,
                                      tolerancia,
                                    )
                                  : atual,
                              )
                            }
                            disabled={!isAdmin || salvando}
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm max-w-[240px]"
                          >
                            <option value="">— sem correspondência —</option>
                            {elenco.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.nomeCompleto}
                                {f.ativo ? "" : " (desligado)"}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">
                          {c.esperado ? `${c.esperado.entrada} às ${c.esperado.saida}` : "—"}
                          {c.esperado &&
                            c.previstoNoPdf &&
                            (c.previstoNoPdf.entrada !== c.esperado.entrada ||
                              c.previstoNoPdf.saida !== c.esperado.saida) && (
                              <span className="block text-xs text-amber-700">
                                no PDF: {c.previstoNoPdf.entrada} às {c.previstoNoPdf.saida}
                              </span>
                            )}
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-700 whitespace-nowrap">
                          {c.resumo.diasAtraso > 0
                            ? `${c.resumo.diasAtraso} d · ${formatarMinutos(c.resumo.minutosAtraso)}`
                            : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-700 whitespace-nowrap">
                          {c.resumo.diasAntecipacao > 0
                            ? `${c.resumo.diasAntecipacao} d · ${formatarMinutos(c.resumo.minutosAntecipacao)}`
                            : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full border text-xs ${CORES_STATUS[c.status]}`}
                          >
                            {LABEL_STATUS_PONTO[c.status]}
                          </span>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDetalhe(detalhe === c.pagina ? null : c.pagina)}
                            className="text-emerald-700 hover:underline"
                          >
                            {detalhe === c.pagina ? "Ocultar dias" : "Ver dias"}
                          </button>
                        </td>
                      </tr>
                      {detalhe === c.pagina && (
                        <tr className="bg-gray-50">
                          <td colSpan={8} className="py-3 px-3">
                            <div className="max-h-72 overflow-y-auto">
                              <table className="min-w-full text-xs">
                                <thead>
                                  <tr className="text-left text-gray-500">
                                    <th className="py-1 pr-3">Dia</th>
                                    <th className="py-1 pr-3">Entrada</th>
                                    <th className="py-1 pr-3">Saída</th>
                                    <th className="py-1 pr-3">Atraso</th>
                                    <th className="py-1 pr-3">Saída antecipada</th>
                                    <th className="py-1 pr-3">Observação</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.resumo.dias.map((d) => (
                                    <tr key={d.data} className="text-gray-600">
                                      <td className="py-1 pr-3">{d.data}</td>
                                      <td className="py-1 pr-3">{d.entrada ?? "—"}</td>
                                      <td className="py-1 pr-3">{d.saida ?? "—"}</td>
                                      <td className="py-1 pr-3">
                                        {d.atrasoMin > 0 ? formatarMinutos(d.atrasoMin) : "—"}
                                      </td>
                                      <td className="py-1 pr-3">
                                        {d.antecipacaoMin > 0
                                          ? formatarMinutos(d.antecipacaoMin)
                                          : "—"}
                                      </td>
                                      <td className="py-1 pr-3">{d.motivo || "—"}</td>
                                    </tr>
                                  ))}
                                  {c.resumo.dias.length === 0 && (
                                    <tr>
                                      <td colSpan={6} className="py-2 text-gray-400">
                                        Página sem dias calculados (funcionário não vinculado ou sem
                                        horário cadastrado).
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Ranking
              titulo="Ranking de atrasos"
              vazio="Nenhum atraso identificado nesta folha."
              linhas={atrasos}
            />
            <Ranking
              titulo="Ranking de saídas antecipadas"
              vazio="Nenhuma saída antecipada identificada nesta folha."
              linhas={antecipadas}
            />
          </div>
        </>
      )}

      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-gray-800">Histórico por competência</h3>
        {folhas.isLoading ? (
          <p className="text-sm text-gray-500 mt-2">Carregando…</p>
        ) : (folhas.data ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 mt-2">Nenhuma folha de ponto processada ainda.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3">Competência</th>
                  <th className="py-2 pr-3">Arquivo</th>
                  <th className="py-2 pr-3">Formato</th>
                  <th className="py-2 pr-3 text-right">Tolerância</th>
                  <th className="py-2 pr-3 text-right">Funcionários</th>
                  <th className="py-2 pr-3">Processado em</th>
                  <th className="py-2 pr-3">Por</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {(folhas.data ?? []).map((f) => (
                  <tr key={f.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-700">{competenciaExtenso(f.competencia)}</td>
                    <td className="py-2 pr-3 text-gray-600">{f.arquivo_nome || "—"}</td>
                    <td className="py-2 pr-3 text-gray-600">{LAYOUTS[f.layout] ?? f.layout}</td>
                    <td className="py-2 pr-3 text-right text-gray-600">{f.tolerancia_min} min</td>
                    <td className="py-2 pr-3 text-right text-gray-600">{f.paginas_processadas}</td>
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">
                      {new Date(f.processado_em).toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{f.processado_por_nome || "—"}</td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => setFolhaHistorico(folhaHistorico === f.id ? null : f.id)}
                        className="text-emerald-700 hover:underline"
                      >
                        {folhaHistorico === f.id ? "Ocultar rankings" : "Ver rankings"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {folhaHistorico && (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {entradas.isLoading ? (
              <p className="text-sm text-gray-500">Carregando rankings…</p>
            ) : (
              <>
                <Ranking
                  titulo="Ranking de atrasos"
                  vazio="Nenhum atraso nesta competência."
                  linhas={historicoAtrasos}
                />
                <Ranking
                  titulo="Ranking de saídas antecipadas"
                  vazio="Nenhuma saída antecipada nesta competência."
                  linhas={historicoAntecipadas}
                />
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default FolhaPonto;
