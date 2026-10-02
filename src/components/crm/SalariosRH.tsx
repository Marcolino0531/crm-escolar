import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Funcionario } from "@/lib/crm/types";
import { parseBRLNumber } from "@/lib/currency";
import {
  competenciaAtual,
  competenciaDe,
  historicoDoFuncionario,
  partesCompetencia,
  preenchimentoSalario,
  rotuloCompetencia,
  salarioVigente,
  validarSalario,
} from "@/lib/rh-salario";
import { MESES_PT } from "@/lib/rh-periodo";
import {
  excluirSalario,
  listarSalarios,
  salvarFolhaSalario,
  salvarSalario,
} from "@/lib/rh-salario.functions";
import { montarFolhaSalario } from "@/lib/rh-folhas";
import type { ItemLote } from "@/lib/folha-pagamento";

interface SalariosRHProps {
  schoolId: string | null;
  funcionarios: Funcionario[];
  // canEdit("rh.pagamentos.salario") — independente do restante do RH.
  podeEditar: boolean;
  // Chamado após salvar uma folha de Salário (recarrega Folhas Salvas).
  onFolhaSalva?: () => void;
  // Competência controlada pela tela da Folha (Resumo).
  competencia?: string;
  onCompetenciaChange?: (c: string) => void;
  // Lote da folha importada na competência (Confirmados + Manuais); null = sem folha importada.
  loteFolha?: {
    itens: ItemLote[];
    total: number;
    emConferencia: string[];
    semCadastro: string[];
  } | null;
  // Funcionários presentes na folha importada da competência (salário vem do Extrato Mensal).
  naFolha?: ReadonlySet<string>;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
const paraInput = (n: number | null) =>
  n == null
    ? ""
    : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Dois selects lado a lado (mês e ano), mesmo estilo da Estatística.
export const SeletorCompetencia: React.FC<{
  value: string;
  onChange: (c: string) => void;
  compacto?: boolean;
}> = ({ value, onChange, compacto }) => {
  const { ano, mes } = partesCompetencia(value);
  const anoAtual = new Date().getFullYear();
  const anos = useMemo(() => {
    const s = new Set<number>([ano]);
    for (let a = anoAtual - 3; a <= anoAtual + 1; a++) s.add(a);
    return [...s].sort((a, b) => b - a);
  }, [ano, anoAtual]);
  const cls = `border border-gray-300 rounded-md px-2 py-1 text-sm ${compacto ? "" : "flex-1"}`;
  return (
    <div className="flex items-center gap-2">
      <select
        value={mes}
        onChange={(e) => onChange(competenciaDe(ano, Number(e.target.value)))}
        className={cls}
      >
        {MESES_PT.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select
        value={ano}
        onChange={(e) => onChange(competenciaDe(Number(e.target.value), mes))}
        className={cls}
      >
        {anos.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </div>
  );
};

const SalariosRH: React.FC<SalariosRHProps> = ({
  schoolId,
  funcionarios,
  podeEditar,
  onFolhaSalva,
  competencia,
  onCompetenciaChange,
  loteFolha = null,
  naFolha,
}) => {
  const qc = useQueryClient();
  const listar = useServerFn(listarSalarios);
  const salvar = useServerFn(salvarSalario);
  const excluir = useServerFn(excluirSalario);
  const salvarFolha = useServerFn(salvarFolhaSalario);
  const [modalFolha, setModalFolha] = useState(false);
  const [folhaTitulo, setFolhaTitulo] = useState("");
  const [folhaData, setFolhaData] = useState("");

  const [competenciaLocal, setCompetenciaLocal] = useState(() => competenciaAtual());
  const competenciaRef = competencia ?? competenciaLocal;
  const setCompetenciaRef = onCompetenciaChange ?? setCompetenciaLocal;
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [novaCompetencia, setNovaCompetencia] = useState(() => competenciaAtual());
  const [novoValor, setNovoValor] = useState("");
  const [novoLiquido, setNovoLiquido] = useState("");
  const [novaObs, setNovaObs] = useState("");

  const salarios = useQuery({
    queryKey: ["rh-salarios", schoolId],
    queryFn: async () => listar({ data: { schoolId } }),
  });

  const invalidar = () => void qc.invalidateQueries({ queryKey: ["rh-salarios", schoolId] });

  const gravar = useMutation({
    mutationFn: async () => {
      if (!selecionadoId) throw new Error("Selecione um funcionário.");
      const input = {
        competencia: novaCompetencia,
        valor: parseBRLNumber(novoValor),
        valorLiquido: novoLiquido.trim() ? parseBRLNumber(novoLiquido) : null,
      };
      const erros = validarSalario(input);
      const msg = erros.competencia ?? erros.valor ?? erros.valorLiquido;
      if (msg) throw new Error(msg);
      return salvar({ data: { funcionarioId: selecionadoId, ...input, observacao: novaObs } });
    },
    onSuccess: () => {
      toast.success("Salário salvo.");
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => excluir({ data: { id } }),
    onSuccess: () => {
      toast.success("Registro excluído.");
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível excluir."),
  });

  const ativos = useMemo(
    () =>
      funcionarios
        .filter((f) => !f.dataRescisao)
        .sort((a, b) => collator.compare(a.nomeCompleto, b.nomeCompleto)),
    [funcionarios],
  );
  const registros = useMemo(() => salarios.data ?? [], [salarios.data]);
  const folha = useMemo(() => {
    if (loteFolha) {
      return {
        itens: loteFolha.itens,
        total: loteFolha.total,
        semSalario: loteFolha.semCadastro,
        emConferencia: loteFolha.emConferencia,
      };
    }
    return { ...montarFolhaSalario(ativos, registros, competenciaRef), emConferencia: [] };
  }, [loteFolha, ativos, registros, competenciaRef]);

  const abrirModalFolha = () => {
    if (!schoolId) {
      toast.error("Selecione uma unidade específica para salvar a folha.");
      return;
    }
    if (folha.itens.length === 0) {
      toast.error("Nenhum funcionário para entrar na folha desta competência.");
      return;
    }
    setFolhaTitulo(`Salário ${rotuloCompetencia(competenciaRef)}`);
    setFolhaData("");
    setModalFolha(true);
  };

  const gravarFolha = useMutation({
    mutationFn: async () => {
      if (!schoolId) throw new Error("Selecione uma unidade específica.");
      if (!folhaTitulo.trim()) throw new Error("Informe um nome para a folha.");
      return salvarFolha({
        data: {
          schoolId,
          titulo: folhaTitulo.trim(),
          competencia: competenciaRef,
          dataPagamento: folhaData || null,
          itens: folha.itens,
        },
      });
    },
    onSuccess: () => {
      toast.success("Folha de pagamento salva em Folhas Salvas.");
      setModalFolha(false);
      onFolhaSalva?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const selecionado = ativos.find((f) => f.id === selecionadoId) ?? null;
  const historico = selecionado ? historicoDoFuncionario(registros, selecionado.id) : [];

  // Ao trocar funcionário/competência (ou recarregar), pré-preenche com o registro
  // próprio ou, se não houver, com o último valor conhecido (salarioVigente).
  const preenchimento = useMemo(
    () => (selecionadoId ? preenchimentoSalario(registros, selecionadoId, novaCompetencia) : null),
    [registros, selecionadoId, novaCompetencia],
  );
  useEffect(() => {
    if (!preenchimento) return;
    setNovoValor(paraInput(preenchimento.valor));
    setNovoLiquido(paraInput(preenchimento.valorLiquido));
    setNovaObs(preenchimento.observacao);
  }, [preenchimento]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Salário base vigente</h3>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Competência
              <SeletorCompetencia value={competenciaRef} onChange={setCompetenciaRef} compacto />
            </label>
            {podeEditar && (
              <button
                type="button"
                onClick={abrirModalFolha}
                disabled={salarios.isLoading}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Salvar Folha de Pagamento
              </button>
            )}
          </div>
        </div>
        {salarios.isLoading ? (
          <p className="px-4 py-6 text-sm text-gray-400">Carregando…</p>
        ) : salarios.isError ? (
          <p className="px-4 py-6 text-sm text-red-600">
            {salarios.error instanceof Error ? salarios.error.message : "Erro ao carregar."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Funcionário</th>
                <th className="text-left px-4 py-2">Cargo</th>
                <th className="text-right px-4 py-2">Bruto</th>
                <th className="text-right px-4 py-2">Líquido</th>
                <th className="text-left px-4 py-2">Desde</th>
              </tr>
            </thead>
            <tbody>
              {ativos.map((f) => {
                const v = salarioVigente(registros, f.id, competenciaRef);
                return (
                  <tr
                    key={f.id}
                    onClick={() => setSelecionadoId(f.id)}
                    className={`border-t border-gray-100 cursor-pointer hover:bg-emerald-50 ${
                      f.id === selecionadoId ? "bg-emerald-50" : ""
                    }`}
                  >
                    <td className="px-4 py-2 font-medium text-gray-800">{f.nomeCompleto}</td>
                    <td className="px-4 py-2 text-gray-500">{f.cargo ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {v ? brl(v.valor) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {v?.valorLiquido != null ? (
                        brl(v.valorLiquido)
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {v ? rotuloCompetencia(v.competencia) : "—"}
                    </td>
                  </tr>
                );
              })}
              {ativos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                    Nenhum funcionário ativo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">
          {selecionado ? selecionado.nomeCompleto : "Selecione um funcionário"}
        </h3>
        {selecionado && (
          <>
            {naFolha?.has(selecionado.id) && (
              <p className="text-xs text-emerald-700">
                Na folha importada (Extrato Mensal) de {rotuloCompetencia(competenciaRef)}: bruto e
                líquido vêm da aba Folha.
              </p>
            )}
            {podeEditar && !naFolha?.has(selecionado.id) && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  gravar.mutate();
                }}
              >
                <div className="block text-xs text-gray-500">
                  Competência
                  <div className="mt-1">
                    <SeletorCompetencia value={novaCompetencia} onChange={setNovaCompetencia} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-gray-500">
                    Bruto (R$)
                    <input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={novoValor}
                      onChange={(e) => setNovoValor(e.target.value)}
                      className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-500">
                    Líquido (R$)
                    <input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={novoLiquido}
                      onChange={(e) => setNovoLiquido(e.target.value)}
                      className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                {preenchimento && !preenchimento.proprio && preenchimento.origem && (
                  <p className="text-[11px] text-amber-700">
                    Sem registro em {rotuloCompetencia(novaCompetencia)}: valores herdados de{" "}
                    {rotuloCompetencia(preenchimento.origem)}. Ajuste e salve para criar esta
                    competência.
                  </p>
                )}
                <label className="block text-xs text-gray-500">
                  Observação (opcional)
                  <input
                    value={novaObs}
                    onChange={(e) => setNovaObs(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  disabled={gravar.isPending}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-md py-1.5"
                >
                  {gravar.isPending
                    ? "Salvando…"
                    : preenchimento?.proprio
                      ? `Atualizar ${rotuloCompetencia(novaCompetencia)}`
                      : `Salvar ${rotuloCompetencia(novaCompetencia)}`}
                </button>
                <p className="text-[11px] text-gray-400">
                  Cada competência é um registro próprio; as anteriores ficam no histórico.
                </p>
              </form>
            )}
            <div>
              <h4 className="text-xs uppercase text-gray-500 mb-1">Histórico</h4>
              {historico.length === 0 ? (
                <p className="text-sm text-gray-400">Nenhum salário cadastrado.</p>
              ) : (
                <ul className="divide-y divide-gray-100 text-sm">
                  {historico.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-2 py-1.5">
                      <div>
                        <span className="font-medium text-gray-700">
                          {rotuloCompetencia(r.competencia)}
                        </span>
                        <span className="ml-2 tabular-nums">{brl(r.valor)}</span>
                        {r.valorLiquido != null && (
                          <span className="ml-2 tabular-nums text-gray-500">
                            · líq. {brl(r.valorLiquido)}
                          </span>
                        )}
                        {r.observacao && <p className="text-xs text-gray-500">{r.observacao}</p>}
                        <p className="text-[11px] text-gray-400">
                          {r.criadoPor}
                          {r.criadoEm && ` · ${new Date(r.criadoEm).toLocaleDateString("pt-BR")}`}
                        </p>
                      </div>
                      {podeEditar && (
                        <button
                          type="button"
                          title="Excluir registro"
                          onClick={() => {
                            if (
                              confirm(`Excluir o salário de ${rotuloCompetencia(r.competencia)}?`)
                            )
                              remover.mutate(r.id);
                          }}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {modalFolha && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !gravarFolha.isPending && setModalFolha(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-4 shadow-lg space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-bold text-gray-800">
              Salvar folha de Salário — {rotuloCompetencia(competenciaRef)}
            </h4>
            <p className="text-xs text-gray-500">
              {folha.itens.length} funcionário(s) · total {brl(folha.total)}.{" "}
              {loteFolha
                ? "Folha importada: entram os Confirmados e os Manuais, pelo líquido (sem restituição)."
                : "Usa o líquido quando informado, senão o bruto."}
            </p>
            {folha.emConferencia.length > 0 && (
              <p className="text-xs font-medium text-amber-700">
                Em conferência (ficam fora): {folha.emConferencia.join(", ")}
              </p>
            )}
            {folha.semSalario.length > 0 && (
              <p className="text-xs text-amber-700">
                {loteFolha ? "Sem cadastro no RH (ficam fora)" : "Sem salário vigente (ficam fora)"}
                : {folha.semSalario.join(", ")}
              </p>
            )}
            <label className="block text-xs text-gray-600">
              Nome da folha
              <input
                type="text"
                value={folhaTitulo}
                autoFocus
                onChange={(e) => setFolhaTitulo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-gray-600">
              Data de pagamento (opcional)
              <input
                type="date"
                value={folhaData}
                onChange={(e) => setFolhaData(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setModalFolha(false)}
                disabled={gravarFolha.isPending}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => gravarFolha.mutate()}
                disabled={gravarFolha.isPending}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {gravarFolha.isPending ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalariosRH;
