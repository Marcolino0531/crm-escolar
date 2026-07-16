import React, { useMemo, useState } from "react";
import { Funcionario, CategoriaFalta } from "@/lib/crm/types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FechamentoVTProps {
  // Já filtrados pelo filtro global de unidade (mesma lista da tabela de RH).
  funcionarios: Funcionario[];
  // Unidade ativa no seletor global (null em "Todas as Unidades").
  schoolId: string | null;
  // Chamado após salvar uma folha, para atualizar a aba "Folhas Salvas".
  onFolhaSalva?: () => void;
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

const FechamentoVT: React.FC<FechamentoVTProps> = ({ funcionarios, schoolId, onFolhaSalva }) => {
  const [mesReferencia, setMesReferencia] = useState<string>(mesAtualIso);
  const [modalAberto, setModalAberto] = useState(false);
  const [folhaTitulo, setFolhaTitulo] = useState("");
  const [folhaData, setFolhaData] = useState("");
  const [salvando, setSalvando] = useState(false);
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
        // Só funcionários ATIVOS e elegíveis ao VT entram no fechamento.
        // Desligados (com data de rescisão) ficam de fora da listagem e de
        // qualquer cálculo de folha/benefício.
        .filter((f) => f.recebeVt && !f.dataRescisao)
        .map((f) => {
          // TODAS as Faltas Integrais do mês (com e sem atestado): qualquer
          // ausência integral abate o benefício do dia, independente de
          // justificativa.
          const faltasDescontadas = (f.faltas ?? []).filter(
            (fa) =>
              categoriaDe(fa.categoria) === "integral" && (fa.data ?? "").startsWith(mesReferencia),
          ).length;
          const valorDiario = f.valorDiarioVt ?? 0;
          const diasUteis = diasDe(f.id);
          const total = Math.max(0, diasUteis - faltasDescontadas) * valorDiario;
          return {
            id: f.id,
            nome: f.nomeCompleto,
            valorDiario,
            faltasDescontadas,
            diasUteis,
            total,
          };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [funcionarios, mesReferencia, diasTrabalhados, diasPorFunc],
  );

  const totalGeral = linhas.reduce((acc, l) => acc + l.total, 0);

  const abrirModalSalvar = () => {
    if (linhas.length === 0) return;
    if (!schoolId) {
      toast.error("Selecione uma unidade específica para salvar a folha.");
      return;
    }
    setFolhaTitulo("");
    setFolhaData("");
    setModalAberto(true);
  };

  const salvarFolha = async () => {
    if (!schoolId || !folhaTitulo.trim() || linhas.length === 0) return;
    setSalvando(true);
    try {
      const { data: batch, error: bErr } = await supabase
        .from("hr_transport_batches" as never)
        .insert({
          school_id: schoolId,
          title: folhaTitulo.trim(),
          payment_date: folhaData || null,
          reference_month: mesReferencia || null,
          total_amount: totalGeral,
        } as never)
        .select("id")
        .single();
      if (bErr || !batch) {
        toast.error(`Falha ao salvar a folha: ${bErr?.message ?? "erro desconhecido"}`);
        return;
      }
      const batchId = (batch as { id: string }).id;
      const itens = linhas.map((l) => ({
        batch_id: batchId,
        employee_id: l.id,
        employee_name: l.nome,
        daily_value: l.valorDiario,
        working_days: l.diasUteis,
        absences: l.faltasDescontadas,
        total_amount: l.total,
      }));
      const { error: iErr } = await supabase
        .from("hr_transport_batch_items" as never)
        .insert(itens as never);
      if (iErr) {
        await supabase
          .from("hr_transport_batches" as never)
          .delete()
          .eq("id", batchId);
        toast.error(`Falha ao salvar os itens da folha: ${iErr.message}`);
        return;
      }
      toast.success("Folha de pagamento salva.");
      setModalAberto(false);
      onFolhaSalva?.();
    } finally {
      setSalvando(false);
    }
  };

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportarCSV}
            disabled={linhas.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Exportar Excel/CSV
          </button>
          <button
            type="button"
            onClick={abrirModalSalvar}
            disabled={linhas.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-emerald-600 to-teal-600 rounded-lg hover:from-emerald-700 hover:to-teal-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            Salvar Folha de Pagamento
          </button>
        </div>
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
                        value={
                          diasPorFunc[l.id] !== undefined ? diasPorFunc[l.id] : diasTrabalhados
                        }
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
                  <td
                    colSpan={4}
                    className="px-3 py-2 text-sm font-semibold text-gray-700 text-right"
                  >
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

      {modalAberto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 rounded-t-2xl flex items-center justify-between">
              <h2 className="text-white text-lg font-bold">Salvar Folha de Pagamento</h2>
              <button
                type="button"
                onClick={() => setModalAberto(false)}
                className="text-white/80 hover:text-white transition-colors text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-500">
                Congela {linhas.length} funcionário(s) com os dias e valores atuais da tela. Total:{" "}
                <span className="font-semibold text-emerald-700">{fmtBRL(totalGeral)}</span>.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome da Folha <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={folhaTitulo}
                  onChange={(e) => setFolhaTitulo(e.target.value)}
                  placeholder="Ex: 1ª Quinzena Julho"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data Programada do Pagamento
                </label>
                <input
                  type="date"
                  value={folhaData}
                  onChange={(e) => setFolhaData(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalAberto(false)}
                  disabled={salvando}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={salvarFolha}
                  disabled={!folhaTitulo.trim() || salvando}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 transition-colors text-sm font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {salvando ? "Salvando…" : "Salvar Folha"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FechamentoVT;
