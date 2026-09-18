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
import { excluirSalario, listarSalarios, salvarSalario } from "@/lib/rh-salario.functions";

interface SalariosRHProps {
  schoolId: string | null;
  funcionarios: Funcionario[];
  // canEdit("rh_salario") — independente de canEdit("rh").
  podeEditar: boolean;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
const paraInput = (n: number | null) =>
  n == null
    ? ""
    : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Dois selects lado a lado (mês e ano), mesmo estilo da Estatística.
const SeletorCompetencia: React.FC<{
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

const SalariosRH: React.FC<SalariosRHProps> = ({ schoolId, funcionarios, podeEditar }) => {
  const qc = useQueryClient();
  const listar = useServerFn(listarSalarios);
  const salvar = useServerFn(salvarSalario);
  const excluir = useServerFn(excluirSalario);

  const [competenciaRef, setCompetenciaRef] = useState(() => competenciaAtual());
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [novaCompetencia, setNovaCompetencia] = useState(() => competenciaAtual());
  const [novoValor, setNovoValor] = useState("");
  const [novoLiquido, setNovoLiquido] = useState("");
  const [novaObs, setNovaObs] = useState("");
  const [campo, setCampo] = useState<"bruto" | "liquido">("bruto");

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
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Competência
            <SeletorCompetencia value={competenciaRef} onChange={setCompetenciaRef} compacto />
          </label>
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
            {podeEditar && (
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
                <div className="flex border-b border-gray-200 text-sm">
                  {(
                    [
                      { id: "bruto", label: "Bruto" },
                      { id: "liquido", label: "Líquido" },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setCampo(t.id)}
                      className={`px-3 py-1.5 -mb-px border-b-2 font-medium ${
                        campo === t.id
                          ? "border-emerald-600 text-emerald-700"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {campo === "bruto" ? (
                  <label className="block text-xs text-gray-500">
                    Salário bruto (R$)
                    <input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={novoValor}
                      onChange={(e) => setNovoValor(e.target.value)}
                      className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                    />
                  </label>
                ) : (
                  <label className="block text-xs text-gray-500">
                    Salário líquido (R$)
                    <input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={novoLiquido}
                      onChange={(e) => setNovoLiquido(e.target.value)}
                      className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                    />
                  </label>
                )}
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
    </div>
  );
};

export default SalariosRH;
