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
  diasUteis: number;
  total: number;
}

const parseDias = (v: string): number => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const FechamentoVT: React.FC<FechamentoVTProps> = ({ funcionarios }) => {
  const [mesReferencia, setMesReferencia] = useState<string>(mesAtualIso);
  // Preenchedor em massa: valor padrão aplicado a todos os funcionários.
  const [diasTrabalhados, setDiasTrabalhados] = useState<string>("22");
  // Exceções por funcionário (férias/recessos): sobrescrevem o valor em massa.
  // Keyed por id; ausência = usa o valor global.
  const [diasPorFunc, setDiasPorFunc] = useState<Record<string, string>>({});

  // Ao digitar no input global, aplica a todos: limpa as exceções individuais.
  const aplicarEmMassa = (valor: string) => {
    setDiasTrabalhados(valor);
    setDiasPorFunc({});
  };

  const editarLinha = (id: string, valor: string) => {
    setDiasPorFunc((prev) => ({ ...prev, [id]: valor }));
  };

  const diasDe = (id: string): number => {
    const override = diasPorFunc[id];
    return parseDias(override !== undefined ? override : diasTrabalhados);
  };

  const linhas: LinhaVT[] = useMemo(
    () =>
      funcionarios
        // Só funcionários elegíveis ao VT entram no fechamento.
        .filter((f) => f.recebeVt)
        .map((f) => {
          // TODAS as Faltas Integrais do mês (com e sem atestado): qualquer
          // ausência integral abate o benefício do dia, independente de
          // justificativa.
          const faltasDescontadas = (f.faltas ?? []).filter(
            (fa) =>
              categoriaDe(fa.categoria) === "integral" &&
              (fa.data ?? "").startsWith(mesReferencia),
          ).length;
          const valorDiario = f.valorDiarioVt ?? 0;
          const diasUteis = diasDe(f.id);
          const total = Math.max(0, diasUteis - faltasDescontadas) * valorDiario;
          return { id: f.id, nome: f.nomeCompleto, valorDiario, faltasDescontadas, diasUteis, total };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [funcionarios, mesReferencia, diasTrabalhados, diasPorFunc],
  );

  const totalGeral = linhas.reduce((acc, l) => acc + l.total, 0);

  const exportarCSV = () => {
    if (linhas.length === 0) return;
    const cab = ["Nome", "Valor Diário", "Dias Úteis", "Faltas Descontadas", "Total a Pagar"];
    const linhasCsv = linhas.map((l) =>
      [
        l.nome,
        l.valorDiario.toFixed(2).replace(".", ","),
        String(l.diasUteis),
        String(l.faltasDescontadas),
        l.total.toFixed(2).replace(".", ","),
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const csv = [cab.map((c) => `"${c}"`).join(";"), ...linhasCsv].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fechamento-vt-${mesReferencia}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span>🚌</span>
          <h3 className="text-sm font-bold text-gray-700">Fechamento de Vale-Transporte</h3>
        </div>
        <button
          type="button"
          onClick={exportarCSV}
          disabled={linhas.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Exportar Excel/CSV
        </button>
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
              Quantidade de Dias Úteis do Próximo Mês
            </label>
            <input
              type="number"
              min={0}
              value={diasTrabalhados}
              onChange={(e) => aplicarEmMassa(e.target.value)}
              placeholder="22"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              Aplica a todos os funcionários. Ajuste linhas individuais (férias/recessos) direto na
              tabela. Total = (Dias Úteis − Faltas Integrais do mês) × Valor Diário.
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
                  Dias Úteis
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
                    Nenhum funcionário elegível ao VT nesta unidade.
                  </td>
                </tr>
              ) : (
                linhas.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm font-medium text-gray-800">{l.nome}</td>
                    <td className="px-3 py-2 text-sm text-gray-600 text-right tabular-nums">
                      {fmtBRL(l.valorDiario)}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600 text-right tabular-nums">
                      <input
                        type="number"
                        min={0}
                        value={diasPorFunc[l.id] !== undefined ? diasPorFunc[l.id] : diasTrabalhados}
                        onChange={(e) => editarLinha(l.id, e.target.value)}
                        className={`w-16 px-2 py-1 text-right tabular-nums border rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 ${
                          diasPorFunc[l.id] !== undefined
                            ? "border-amber-300 bg-amber-50"
                            : "border-gray-300"
                        }`}
                      />
                    </td>
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
