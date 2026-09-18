import React, { useMemo, useState } from "react";
import { Unidade, Funcionario, Genero, EstadoCivil } from "@/lib/crm/types";
import { useFuncionarios } from "@/lib/crm/hooks";
import { usePermissions, useSchool } from "@/lib/app-context";
import { toast } from "sonner";
import FuncionarioModal from "./FuncionarioModal";
import RankingFaltas from "./RankingFaltas";
import RankingPonto from "./RankingPonto";
import {
  MESES_PT,
  PeriodoRh,
  anosDisponiveis,
  periodoAtual,
  periodoMesAnterior,
} from "@/lib/rh-periodo";
import FechamentoVT from "./FechamentoVT";
import FolhasSalvas from "./FolhasSalvas";
import Terceirizados from "./Terceirizados";
import Contracheques from "./Contracheques";
import FolhaPonto from "./FolhaPonto";
import SalariosRH from "./SalariosRH";
import Aniversariantes from "./Aniversariantes";
import {
  acessoSalario,
  subAbasPagamentos,
  subPagamentosPermitida,
  type SubPagamentos,
} from "@/lib/rh-salario-acesso";
import type { PermissoesLotes } from "@/lib/rh-folhas";
import {
  ColunaOrdenacao,
  ORDENACAO_PADRAO,
  OrdenacaoRh,
  alternarOrdenacao,
  ordenarFuncionarios,
} from "@/lib/rh-ordenacao";

interface RHPageProps {
  rhHook: ReturnType<typeof useFuncionarios>;
  unidadeSelecionada: Unidade;
}

const converterParaBR = (dataISO: string): string => {
  if (!dataISO) return "";
  const partes = dataISO.split("-");
  if (partes.length !== 3) return "";
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
};

const generoLabel = (g?: Genero): string => {
  const map: Record<Genero, string> = {
    feminino: "Feminino",
    masculino: "Masculino",
    outro: "Outro",
    "prefiro-nao-informar": "Prefiro não informar",
  };
  return g ? map[g] || "" : "";
};

const estadoCivilLabel = (e?: EstadoCivil): string => {
  const map: Record<EstadoCivil, string> = {
    solteiro: "Solteiro(a)",
    casado: "Casado(a)",
    divorciado: "Divorciado(a)",
    viuvo: "Viúvo(a)",
    outro: "Outro",
  };
  return e ? map[e] || "" : "";
};

interface ColunaExport {
  id: string;
  label: string;
  getValue: (f: Funcionario) => string;
}

const COLUNAS_EXPORT: ColunaExport[] = [
  { id: "nomeCompleto", label: "Nome", getValue: (f) => f.nomeCompleto },
  { id: "cpf", label: "CPF", getValue: (f) => f.cpf || "" },
  {
    id: "dataNascimento",
    label: "Data de Nascimento",
    getValue: (f) => converterParaBR(f.dataNascimento || ""),
  },
  { id: "cargo", label: "Cargo", getValue: (f) => f.cargo || "" },
  { id: "genero", label: "Gênero", getValue: (f) => generoLabel(f.genero) },
  { id: "estadoCivil", label: "Estado Civil", getValue: (f) => estadoCivilLabel(f.estadoCivil) },
  { id: "unidade", label: "Unidade", getValue: (f) => f.unidade },
  {
    id: "dataAdmissao",
    label: "Data de Admissão",
    getValue: (f) => converterParaBR(f.dataAdmissao || ""),
  },
  {
    id: "dataInicio",
    label: "Data de Início",
    getValue: (f) => converterParaBR(f.dataInicio || ""),
  },
  {
    id: "dataRescisao",
    label: "Data de Rescisão",
    getValue: (f) => converterParaBR(f.dataRescisao || ""),
  },
  {
    id: "horarioTrabalho",
    label: "Horário de Trabalho",
    getValue: (f) => `${f.horarioTrabalhoInicio} às ${f.horarioTrabalhoFim}`,
  },
  {
    id: "horarioAlmoco",
    label: "Horário de Almoço",
    getValue: (f) =>
      f.horarioAlmocoInicio && f.horarioAlmocoFim
        ? `${f.horarioAlmocoInicio} às ${f.horarioAlmocoFim}`
        : "",
  },
  { id: "status", label: "Status", getValue: (f) => (f.dataRescisao ? "Desligado" : "Ativo") },
];

const gerarCSV = (funcionarios: Funcionario[], colunasIds: string[]): string => {
  const colunas = COLUNAS_EXPORT.filter((c) => colunasIds.includes(c.id));
  const header = colunas.map((c) => `"${c.label}"`).join(",");
  const rows = funcionarios.map((f) =>
    colunas
      .map((c) => {
        const val = c.getValue(f);
        return `"${val.replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  return [header, ...rows].join("\n");
};

const downloadCSV = (csv: string, filename: string) => {
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const RHPage: React.FC<RHPageProps> = ({ rhHook, unidadeSelecionada }) => {
  const { canEdit, canView } = usePermissions();
  const { selected } = useSchool();
  const isAdmin = canEdit("rh");
  // Sub-visão Salário: só pelo módulo dedicado rh_salario (canEdit("rh") não conta).
  const salario = acessoSalario({
    canViewRhSalario: canView("rh_salario"),
    canEditRhSalario: canEdit("rh_salario"),
  });
  const schoolId = selected !== "all" ? selected : null;
  const permissoesLotes = useMemo<PermissoesLotes>(
    () => ({
      podeEditarRh: isAdmin,
      podeVerSalario: salario.visivel,
      podeEditarSalario: salario.editavel,
    }),
    [isAdmin, salario.visivel, salario.editavel],
  );
  const {
    funcionarios,
    adicionarFuncionario,
    editarFuncionario,
    removerFuncionario,
    adicionarFerias,
    removerFerias,
    adicionarFalta,
    adicionarFaltasPeriodo,
    editarFalta,
    removerFalta,
    atualizarHorarioTrabalho,
  } = rhHook;
  const [modalAberto, setModalAberto] = useState(false);
  const [funcionarioSelecionadoId, setFuncionarioSelecionadoId] = useState<string | null>(null);
  const [exportModalAberto, setExportModalAberto] = useState(false);
  const [colunasExport, setColunasExport] = useState<string[]>(COLUNAS_EXPORT.map((c) => c.id));
  const [abaStatus, setAbaStatus] = useState<"ativos" | "desligados">("ativos");
  const [ordenacao, setOrdenacao] = useState<OrdenacaoRh>(ORDENACAO_PADRAO);
  const [abaRh, setAbaRh] = useState<
    "funcionarios" | "folhas" | "contracheques" | "ponto" | "estatistica" | "aniversarios"
  >("funcionarios");
  const [subPessoal, setSubPessoal] = useState<"efetivos" | "terceirizados">("efetivos");
  const mostraEfetivos = abaRh === "funcionarios" && subPessoal === "efetivos";
  const [folhasRefresh, setFolhasRefresh] = useState(0);
  // ?sub=salario na URL só abre Salário com permissão; senão cai em Vale Transporte.
  const [subPagamentos, setSubPagamentos] = useState<SubPagamentos>(() =>
    subPagamentosPermitida(
      (typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("sub")) ??
        (salario.visivel ? "salario" : null),
      salario,
    ),
  );
  const subPagamentosEfetiva = subPagamentosPermitida(subPagamentos, salario);
  // Períodos da aba Estatística: faltas manuais começam no mês atual; o ponto
  // eletrônico começa no mês anterior (o fechamento só sai após o fim do mês).
  const [periodoFaltas, setPeriodoFaltas] = useState<PeriodoRh>(() => periodoAtual());
  const [periodoPonto, setPeriodoPonto] = useState<PeriodoRh>(() => periodoMesAnterior());

  const isAtivo = (f: Funcionario) => !f.dataRescisao;
  const funcionariosFiltrados = ordenarFuncionarios(
    funcionarios.filter((f) => (abaStatus === "ativos" ? isAtivo(f) : !isAtivo(f))),
    ordenacao,
  );
  const trocarAbaStatus = (aba: "ativos" | "desligados") => {
    setAbaStatus(aba);
    setOrdenacao(ORDENACAO_PADRAO);
  };
  const thOrdenavel = (coluna: ColunaOrdenacao, rotulo: string) => {
    const ativa = ordenacao.coluna === coluna;
    return (
      <th
        key={coluna}
        aria-sort={ativa ? (ordenacao.direcao === "asc" ? "ascending" : "descending") : "none"}
        className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider"
      >
        <button
          type="button"
          onClick={() => setOrdenacao((o) => alternarOrdenacao(o, coluna))}
          className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-gray-800 ${
            ativa ? "text-emerald-700" : ""
          }`}
        >
          {rotulo}
          <span className={`text-[10px] ${ativa ? "" : "text-gray-300"}`}>
            {ativa ? (ordenacao.direcao === "asc" ? "▲" : "▼") : "⇅"}
          </span>
        </button>
      </th>
    );
  };
  const seletorPeriodo = (
    periodo: PeriodoRh,
    setPeriodo: React.Dispatch<React.SetStateAction<PeriodoRh>>,
  ) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
      <label className="block text-xs font-medium text-gray-600 mb-2">Período dos rankings</label>
      <div className="flex items-center gap-2">
        <select
          value={periodo.modo === "ano" ? "ano" : String(periodo.mes)}
          onChange={(e) =>
            setPeriodo((p) =>
              e.target.value === "ano"
                ? { ...p, modo: "ano" }
                : { ...p, modo: "mes", mes: Number(e.target.value) },
            )
          }
          className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
        >
          <option value="ano">Todos os meses</option>
          {MESES_PT.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={periodo.ano}
          onChange={(e) => setPeriodo((p) => ({ ...p, ano: Number(e.target.value) }))}
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
        >
          {anosDisponiveis([
            String(periodo.ano),
            ...funcionarios.flatMap((f) => (f.faltas ?? []).map((fa) => fa.data)),
          ]).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
  const totalAtivos = funcionarios.filter(isAtivo).length;
  const totalDesligados = funcionarios.length - totalAtivos;

  const funcionarioSelecionado = funcionarioSelecionadoId
    ? funcionarios.find((f) => f.id === funcionarioSelecionadoId) || null
    : null;

  const handleSalvar = (
    dados: Omit<Funcionario, "id" | "ferias" | "faltas" | "criadoEm" | "schoolId">,
  ) => {
    adicionarFuncionario(dados);
    setModalAberto(false);
  };

  const handleClickFuncionario = (funcionario: Funcionario) => {
    setFuncionarioSelecionadoId(funcionario.id);
  };

  const handleFecharDetalhes = () => {
    setFuncionarioSelecionadoId(null);
  };

  const handleEditarSalvar = (
    dados: Omit<Funcionario, "id" | "ferias" | "faltas" | "criadoEm" | "schoolId">,
  ) => {
    if (!funcionarioSelecionadoId) return;
    editarFuncionario(funcionarioSelecionadoId, dados);
    setFuncionarioSelecionadoId(null);
    toast.success("Altera\u00e7\u00f5es salvas com sucesso.");
  };

  const toggleColunaExport = (id: string) => {
    setColunasExport((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const marcarTodos = () => {
    setColunasExport(COLUNAS_EXPORT.map((c) => c.id));
  };

  const handleGerarPlanilha = () => {
    if (colunasExport.length === 0) return;
    const csv = gerarCSV(funcionarios, colunasExport);
    const filename = `funcionarios-${unidadeSelecionada.replace(/\s+/g, "-").toLowerCase()}.csv`;
    downloadCSV(csv, filename);
    setExportModalAberto(false);
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Funcionários — {unidadeSelecionada}</h2>
          <p className="text-sm text-gray-500">
            {funcionarios.length} funcionário(s) cadastrado(s)
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && mostraEfetivos && (
            <button
              onClick={() => setExportModalAberto(true)}
              disabled={funcionarios.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Exportar Planilha
            </button>
          )}
          {isAdmin && mostraEfetivos && (
            <button
              onClick={() => setModalAberto(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:from-emerald-700 hover:to-teal-700 transition-colors text-sm font-medium shadow-md"
            >
              <span>+</span>
              Novo Funcionário
            </button>
          )}
        </div>
      </div>

      {/* Abas principais do RH */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        {(
          [
            { id: "funcionarios", label: "Pessoal" },
            { id: "folhas", label: "Pagamentos" },
            { id: "contracheques", label: "Contracheques" },
            { id: "ponto", label: "Folha de Ponto" },
            { id: "estatistica", label: "Estatística" },
            { id: "aniversarios", label: "Aniversários" },
          ] as const
        ).map((aba) => (
          <button
            key={aba.id}
            type="button"
            onClick={() => setAbaRh(aba.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              abaRh === aba.id
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {aba.label}
          </button>
        ))}
      </div>

      {abaRh === "funcionarios" && (
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 mb-4">
          {(
            [
              { id: "efetivos", label: "Efetivos" },
              { id: "terceirizados", label: "Terceirizados" },
            ] as const
          ).map((sub) => (
            <button
              key={sub.id}
              type="button"
              onClick={() => setSubPessoal(sub.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                subPessoal === sub.id
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}

      {abaRh === "folhas" && (
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 mb-4">
          {subAbasPagamentos(salario).map((sub) => (
            <button
              key={sub.id}
              type="button"
              onClick={() => setSubPagamentos(sub.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                subPagamentosEfetiva === sub.id
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}

      {abaRh === "ponto" ? (
        <FolhaPonto
          funcionarios={funcionarios}
          isAdmin={isAdmin}
          onAtualizarHorario={atualizarHorarioTrabalho}
        />
      ) : abaRh === "contracheques" ? (
        <Contracheques funcionarios={funcionarios} isAdmin={isAdmin} schoolId={schoolId} />
      ) : abaRh === "folhas" ? (
        subPagamentosEfetiva === "salario" ? (
          <SalariosRH
            schoolId={schoolId}
            funcionarios={funcionarios}
            podeEditar={salario.editavel}
            onFolhaSalva={() => setFolhasRefresh((n) => n + 1)}
          />
        ) : subPagamentosEfetiva === "folhas" ? (
          <FolhasSalvas
            schoolId={schoolId}
            permissoes={permissoesLotes}
            refreshKey={folhasRefresh}
          />
        ) : funcionarios.length > 0 ? (
          <FechamentoVT
            funcionarios={funcionarios}
            schoolId={schoolId}
            onFolhaSalva={() => setFolhasRefresh((n) => n + 1)}
          />
        ) : (
          <p className="text-sm text-gray-400 italic">Nenhum funcionário na unidade selecionada.</p>
        )
      ) : abaRh === "aniversarios" ? (
        <Aniversariantes funcionarios={funcionarios} />
      ) : abaRh === "estatistica" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Faltas</h3>
            {seletorPeriodo(periodoFaltas, setPeriodoFaltas)}
            <RankingFaltas funcionarios={funcionarios.filter(isAtivo)} periodo={periodoFaltas} />
          </div>
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Ponto eletrônico
            </h3>
            {seletorPeriodo(periodoPonto, setPeriodoPonto)}
            <RankingPonto funcionarios={funcionarios.filter(isAtivo)} periodo={periodoPonto} />
          </div>
        </div>
      ) : subPessoal === "terceirizados" ? (
        <Terceirizados unidadeSelecionada={unidadeSelecionada} isAdmin={isAdmin} />
      ) : funcionarios.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <span className="text-5xl mb-4">👤</span>
          <p className="text-lg font-medium">Nenhum funcionário cadastrado</p>
          <p className="text-sm">Clique em "Novo Funcionário" para começar.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
            {(
              [
                { id: "ativos", label: "Ativos", total: totalAtivos },
                { id: "desligados", label: "Desligados", total: totalDesligados },
              ] as const
            ).map((aba) => (
              <button
                key={aba.id}
                type="button"
                onClick={() => trocarAbaStatus(aba.id)}
                className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                  abaStatus === aba.id
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {aba.label}
                <span
                  className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                    abaStatus === aba.id
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {aba.total}
                </span>
              </button>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {thOrdenavel("nome", "Nome")}
                    {thOrdenavel("cpf", "CPF")}
                    {thOrdenavel("cargo", "Cargo")}
                    {thOrdenavel("admissao", "Admissão")}
                    {abaStatus === "desligados" && thOrdenavel("rescisao", "Rescisão")}
                    {thOrdenavel("horario", "Horário")}
                    {thOrdenavel("status", "Status")}
                    {isAdmin && (
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Ações
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {funcionariosFiltrados.length === 0 && (
                    <tr>
                      <td
                        colSpan={(isAdmin ? 7 : 6) + (abaStatus === "desligados" ? 1 : 0)}
                        className="px-4 py-10 text-center text-sm text-gray-400"
                      >
                        {abaStatus === "ativos"
                          ? "Nenhum funcionário ativo."
                          : "Nenhum funcionário desligado."}
                      </td>
                    </tr>
                  )}
                  {funcionariosFiltrados.map((func) => (
                    <tr
                      key={func.id}
                      onClick={() => handleClickFuncionario(func)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                            <span className="text-emerald-600 text-sm font-bold">
                              {func.nomeCompleto.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="text-sm font-medium text-gray-800">
                            {func.nomeCompleto}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{func.cpf || "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{func.cargo || "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {converterParaBR(func.dataAdmissao || "")}
                      </td>
                      {abaStatus === "desligados" && (
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {converterParaBR(func.dataRescisao || "") || "—"}
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {func.horarioTrabalhoInicio} às {func.horarioTrabalhoFim}
                      </td>
                      <td className="px-4 py-3">
                        {func.dataRescisao ? (
                          <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">
                            Desligado
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full font-medium">
                            Ativo
                          </span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Remover ${func.nomeCompleto}?`)) {
                                removerFuncionario(func.id);
                              }
                            }}
                            className="text-red-400 hover:text-red-600 text-xs font-medium"
                          >
                            Remover
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modalAberto && (
        <FuncionarioModal
          unidadeSelecionada={unidadeSelecionada}
          onSalvar={handleSalvar}
          onFechar={() => setModalAberto(false)}
        />
      )}

      {funcionarioSelecionado && (
        <FuncionarioModal
          unidadeSelecionada={unidadeSelecionada}
          funcionarioExistente={funcionarioSelecionado}
          onSalvar={handleEditarSalvar}
          onFechar={handleFecharDetalhes}
          onAdicionarFerias={isAdmin ? adicionarFerias : undefined}
          onRemoverFerias={isAdmin ? removerFerias : undefined}
          onAdicionarFalta={isAdmin ? adicionarFalta : undefined}
          onAdicionarFaltasPeriodo={isAdmin ? adicionarFaltasPeriodo : undefined}
          onEditarFalta={isAdmin ? editarFalta : undefined}
          onRemoverFalta={isAdmin ? removerFalta : undefined}
          isAdmin={isAdmin}
        />
      )}

      {/* Export Modal */}
      {exportModalAberto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <h2 className="text-white text-lg font-bold">Escolha os dados para exportar</h2>
                </div>
                <button
                  onClick={() => setExportModalAberto(false)}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500">
                  {colunasExport.length} de {COLUNAS_EXPORT.length} colunas selecionadas
                </p>
                <button
                  type="button"
                  onClick={marcarTodos}
                  className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 font-medium transition-colors"
                >
                  Marcar todos
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {COLUNAS_EXPORT.map((col) => (
                  <label
                    key={col.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={colunasExport.includes(col.id)}
                      onChange={() => toggleColunaExport(col.id)}
                      className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
                    />
                    <span className="text-sm text-gray-700">{col.label}</span>
                  </label>
                ))}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setExportModalAberto(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleGerarPlanilha}
                  disabled={colunasExport.length === 0}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 transition-colors text-sm font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Gerar Planilha
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RHPage;
