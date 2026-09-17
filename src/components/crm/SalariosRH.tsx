import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Funcionario } from "@/lib/crm/types";
import { parseBRLNumber } from "@/lib/currency";
import {
  competenciaAtual,
  historicoDoFuncionario,
  rotuloCompetencia,
  salarioVigente,
  validarSalario,
} from "@/lib/rh-salario";
import { excluirSalario, listarSalarios, salvarSalario } from "@/lib/rh-salario.functions";

interface SalariosRHProps {
  schoolId: string | null;
  funcionarios: Funcionario[];
  // canEdit("rh_salario") — independente de canEdit("rh").
  podeEditar: boolean;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

const SalariosRH: React.FC<SalariosRHProps> = ({ schoolId, funcionarios, podeEditar }) => {
  const qc = useQueryClient();
  const listar = useServerFn(listarSalarios);
  const salvar = useServerFn(salvarSalario);
  const excluir = useServerFn(excluirSalario);

  const [competenciaRef, setCompetenciaRef] = useState(() => competenciaAtual());
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [novaCompetencia, setNovaCompetencia] = useState(() => competenciaAtual());
  const [novoValor, setNovoValor] = useState("");
  const [novaObs, setNovaObs] = useState("");

  const salarios = useQuery({
    queryKey: ["rh-salarios", schoolId],
    queryFn: async () => listar({ data: { schoolId } }),
  });

  const invalidar = () => void qc.invalidateQueries({ queryKey: ["rh-salarios", schoolId] });

  const gravar = useMutation({
    mutationFn: async () => {
      if (!selecionadoId) throw new Error("Selecione um funcionário.");
      const input = { competencia: novaCompetencia, valor: parseBRLNumber(novoValor) };
      const erros = validarSalario(input);
      const msg = erros.competencia ?? erros.valor;
      if (msg) throw new Error(msg);
      return salvar({ data: { funcionarioId: selecionadoId, ...input, observacao: novaObs } });
    },
    onSuccess: () => {
      toast.success("Salário salvo.");
      setNovoValor("");
      setNovaObs("");
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
  const registros = salarios.data ?? [];
  const selecionado = ativos.find((f) => f.id === selecionadoId) ?? null;
  const historico = selecionado ? historicoDoFuncionario(registros, selecionado.id) : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Salário base vigente</h3>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Competência
            <input
              type="month"
              value={competenciaRef}
              onChange={(e) => setCompetenciaRef(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm"
            />
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
                <th className="text-right px-4 py-2">Salário</th>
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
                    <td className="px-4 py-2 text-gray-500">
                      {v ? rotuloCompetencia(v.competencia) : "—"}
                    </td>
                  </tr>
                );
              })}
              {ativos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
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
                <label className="block text-xs text-gray-500">
                  Competência
                  <input
                    type="month"
                    value={novaCompetencia}
                    onChange={(e) => setNovaCompetencia(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  Salário base (R$)
                  <input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={novoValor}
                    onChange={(e) => setNovoValor(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                  />
                </label>
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
                  {gravar.isPending ? "Salvando…" : "Salvar competência"}
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
