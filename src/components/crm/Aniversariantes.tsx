import React, { useState } from "react";
import { Funcionario } from "@/lib/crm/types";
import { MESES_PT } from "@/lib/rh-periodo";
import { aniversariantesDoMes, mesAtual } from "@/lib/rh-aniversarios";

interface AniversariantesProps {
  funcionarios: Funcionario[];
}

const Aniversariantes: React.FC<AniversariantesProps> = ({ funcionarios }) => {
  const [mes, setMes] = useState<number>(() => mesAtual());
  const lista = aniversariantesDoMes(funcionarios, mes);
  const mudarMes = (delta: number) => setMes((m) => ((m - 1 + delta + 12) % 12) + 1);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => mudarMes(-1)}
          aria-label="Mês anterior"
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          ‹
        </button>
        <select
          value={mes}
          onChange={(e) => setMes(Number(e.target.value))}
          className="flex-1 max-w-xs px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
        >
          {MESES_PT.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => mudarMes(1)}
          aria-label="Próximo mês"
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          ›
        </button>
        <span className="ml-auto text-sm text-gray-500">
          {lista.length} aniversariante(s) em {MESES_PT[mes - 1]}
        </span>
      </div>

      {lista.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
          Nenhum aniversariante em {MESES_PT[mes - 1]}.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Data
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Nome
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Cargo
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-emerald-700">{a.data}</td>
                  <td className="px-4 py-3 text-sm text-gray-800">{a.nome}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{a.cargo || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Aniversariantes;
