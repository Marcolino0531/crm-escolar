import React, { useMemo, useState } from "react";
import { Funcionario, CategoriaFalta } from "@/lib/crm/types";

interface FechamentoVTProps {
  // Já filtrados pelo filtro global de unidade (mesma lista da tabela de RH).
  funcionarios: Funcionario[];
}

const categoriaDe = (c?: CategoriaFalta): CategoriaFalta => c ?? "integral";

const fmtBRL = (n: number): string =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// "YYYY-MM" -> "junho de 2026"
const mesLabel = (mesIso: string): string => {
  if (!mesIso) return "";
  const [y, m] = mesIso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

const mesAtualIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

interface LinhaVT {
  id: string;
  nome: string;
  valorDiario: number;
  faltasDescontadas: number;
  total: number;
}

const FechamentoVT: React.FC<FechamentoVTProps> = ({ funcionarios }) => {
  const [mesReferencia, setMesReferencia] = useState<string>(mesAtualIso);
  const [diasTrabalhados, setDiasTrabalhados] = useState<string>("22");

  const dias = useMemo(() => {
    const n = parseInt(diasTrabalhados, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [diasTrabalhados]);

  const linhas: LinhaVT[] = useMemo(
    () =>
      funcionarios
        .map((f) => {
          // Apenas Faltas Integrais Sem Atestado dentro do mês de referência.
          const faltasDescontadas = (f.faltas ?? []).filter(
            (fa) =>
              categoriaDe(fa.categoria) === "integral" &&
              fa.tipo === "sem_atestado" &&
              (fa.data ?? "").startsWith(mesReferencia),
          ).length;
          const valorDiario = f.valorDiarioVt ?? 0;
          const total = Math.max(0, dias - faltasDescontadas) * valorDiario;
          return { id: f.id, nome: f.nomeCompleto, valorDiario, faltasDescontadas, total };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [funcionarios, mesReferencia, dias],
  );

  const totalGeral = linhas.reduce((acc, l) => acc + l.total, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <span>🚌</span>
        <h3 className="text-sm font-bold text-gray-700">Fechamento de Vale-Transporte</h3>
      </div>

      <div className="p-4 space-y-4">
        {/* Inputs globais */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mês de Referência das Faltas
            </label>
            <input
              type="month"
              value={mesReferencia}
              onChange={(e) => setMesReferencia(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
            />
            {mesReferencia && (
              <p className="text-xs text-gray-400 mt-1 capitalize">{mesLabel(mesReferencia)}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Dias Trabalhados no Próximo Mês
            </label>
            <input
              type="number"
              min={0}
              value={diasTrabalhados}
              onChange={(e) => setDiasTrabalhados(e.target.value)}
              placeholder="22"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              Total = (Dias Trabalhados − Faltas Integrais Sem Atestado do mês) × Valor Diário.
            </p>
          </div>
        </div>

        {/* Tabela de resultados */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Nome
                </th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Valor Diário
                </th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Dias Trabalhados
                </th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Faltas Descontadas
                </th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Total a Pagar
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-gray-400 text-sm">
                    Nenhum funcionário para esta unidade.
                  </td>
                </tr>
              ) : (
                linhas.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm font-medium text-gray-800">{l.nome}</td>
                    <td className="px-3 py-2 text-sm text-gray-600 text-right tabular-nums">
                      {fmtBRL(l.valorDiario)}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600 text-right tabular-nums">{dias}</td>
                    <td className="px-3 py-2 text-sm text-right tabular-nums">
                      {l.faltasDescontadas > 0 ? (
                        <span className="text-red-600 font-medium">{l.faltasDescontadas}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm font-bold text-emerald-700 text-right tabular-nums">
                      {fmtBRL(l.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {linhas.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={4} className="px-3 py-2 text-sm font-semibold text-gray-700 text-right">
                    Total Geral
                  </td>
                  <td className="px-3 py-2 text-sm font-bold text-emerald-700 text-right tabular-nums">
                    {fmtBRL(totalGeral)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

export default FechamentoVT;
