import React, { useCallback, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FolhasPagamentoVTProps {
  // Unidade ativa no seletor global (null em "Todas as Unidades").
  schoolId: string | null;
  isAdmin: boolean;
  // Muda quando uma nova folha é salva, para forçar recarga.
  refreshKey?: number;
}

interface Batch {
  id: string;
  title: string;
  payment_date: string | null;
  reference_month: string | null;
  total_amount: number;
  created_at: string;
}

interface BatchItem {
  id: string;
  employee_name: string;
  daily_value: number;
  working_days: number;
  absences: number;
  total_amount: number;
  is_paid: boolean;
}

const fmtBRL = (n: number): string =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (iso: string | null): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const FolhasPagamentoVT: React.FC<FolhasPagamentoVTProps> = ({ schoolId, isAdmin, refreshKey }) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [aberta, setAberta] = useState<Batch | null>(null);
  const [itens, setItens] = useState<BatchItem[]>([]);
  const [itensCarregando, setItensCarregando] = useState(false);
  const [editando, setEditando] = useState<Batch | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [salvandoNome, setSalvandoNome] = useState(false);

  const carregarBatches = useCallback(async () => {
    setCarregando(true);
    let q = supabase
      .from("hr_transport_batches" as never)
      .select("id, title, payment_date, reference_month, total_amount, created_at")
      .order("created_at", { ascending: false });
    if (schoolId) q = q.eq("school_id", schoolId);
    const { data, error } = await q;
    setCarregando(false);
    if (error) {
      toast.error("Não foi possível carregar as folhas.");
      return;
    }
    setBatches((data ?? []) as unknown as Batch[]);
  }, [schoolId]);

  useEffect(() => {
    carregarBatches();
  }, [carregarBatches, refreshKey]);

  const abrirFolha = async (batch: Batch) => {
    setAberta(batch);
    setItensCarregando(true);
    const { data, error } = await supabase
      .from("hr_transport_batch_items" as never)
      .select("id, employee_name, daily_value, working_days, absences, total_amount, is_paid")
      .eq("batch_id", batch.id)
      .order("employee_name", { ascending: true });
    setItensCarregando(false);
    if (error) {
      toast.error("Não foi possível carregar os itens da folha.");
      return;
    }
    setItens((data ?? []) as unknown as BatchItem[]);
  };

  const togglePago = async (item: BatchItem) => {
    const novo = !item.is_paid;
    setItens((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_paid: novo } : i)));
    const { error } = await supabase
      .from("hr_transport_batch_items" as never)
      .update({ is_paid: novo } as never)
      .eq("id", item.id);
    if (error) {
      setItens((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_paid: !novo } : i)));
      toast.error("Não foi possível atualizar o status.");
    }
  };

  const abrirEdicao = (batch: Batch) => {
    setEditando(batch);
    setNovoNome(batch.title);
  };

  const salvarNome = async () => {
    if (!editando) return;
    const nome = novoNome.trim();
    if (!nome) {
      toast.error("Informe um nome para a folha.");
      return;
    }
    setSalvandoNome(true);
    const { error } = await supabase
      .from("hr_transport_batches" as never)
      .update({ title: nome } as never)
      .eq("id", editando.id);
    setSalvandoNome(false);
    if (error) {
      toast.error("Não foi possível renomear a folha.");
      return;
    }
    setBatches((prev) => prev.map((b) => (b.id === editando.id ? { ...b, title: nome } : b)));
    setAberta((prev) => (prev?.id === editando.id ? { ...prev, title: nome } : prev));
    toast.success("Folha renomeada.");
    setEditando(null);
  };

  const excluirFolha = async (batch: Batch) => {
    if (!confirm(`Excluir a folha "${batch.title}"? Isso remove todos os itens dela.`)) return;
    const { error } = await supabase
      .from("hr_transport_batches" as never)
      .delete()
      .eq("id", batch.id);
    if (error) {
      toast.error("Não foi possível excluir a folha.");
      return;
    }
    toast.success("Folha excluída.");
    if (aberta?.id === batch.id) setAberta(null);
    await carregarBatches();
  };

  const pagos = itens.filter((i) => i.is_paid).length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <span>🗂️</span>
        <h3 className="text-sm font-bold text-gray-700">Folhas de Pagamento Salvas</h3>
      </div>

      <div className="p-4">
        {carregando ? (
          <p className="text-sm text-gray-400 italic">Carregando folhas…</p>
        ) : batches.length === 0 ? (
          <p className="text-sm text-gray-400 italic">
            Nenhuma folha salva. Use "Salvar Folha de Pagamento" no Fechamento de VT.
          </p>
        ) : (
          <div className="space-y-2">
            {batches.map((b) => (
              <div key={b.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50">
                  <button
                    type="button"
                    onClick={() => (aberta?.id === b.id ? setAberta(null) : abrirFolha(b))}
                    className="flex items-center gap-2 text-left min-w-0"
                  >
                    <span className="text-gray-400 text-xs">{aberta?.id === b.id ? "▼" : "▶"}</span>
                    <span className="text-sm font-medium text-gray-800 truncate">{b.title}</span>
                    <span className="text-xs text-gray-500 shrink-0">
                      · Pgto {fmtData(b.payment_date)}
                    </span>
                  </button>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-bold text-emerald-700 tabular-nums">
                      {fmtBRL(b.total_amount)}
                    </span>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => abrirEdicao(b)}
                        title="Editar nome"
                        aria-label="Editar nome"
                        className="text-gray-400 hover:text-gray-700"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => excluirFolha(b)}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                </div>

                {aberta?.id === b.id && (
                  <div className="p-3">
                    {itensCarregando ? (
                      <p className="text-xs text-gray-400 italic">Carregando funcionários…</p>
                    ) : itens.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">
                        Nenhum funcionário nesta folha.
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-gray-500 mb-2">
                          {pagos} de {itens.length} pago(s)
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                  Nome
                                </th>
                                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                  Dias
                                </th>
                                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                  Faltas
                                </th>
                                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                  Total
                                </th>
                                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                  Status
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {itens.map((it) => (
                                <tr key={it.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 text-sm font-medium text-gray-800">
                                    {it.employee_name}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-600 text-right tabular-nums">
                                    {it.working_days}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-right tabular-nums">
                                    {it.absences > 0 ? (
                                      <span className="text-red-600 font-medium">
                                        {it.absences}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400">0</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-sm font-bold text-emerald-700 text-right tabular-nums">
                                    {fmtBRL(it.total_amount)}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button
                                      type="button"
                                      onClick={() => isAdmin && togglePago(it)}
                                      disabled={!isAdmin}
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                        it.is_paid
                                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                                          : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                                      } ${isAdmin ? "cursor-pointer" : "cursor-default opacity-80"}`}
                                    >
                                      <span
                                        className={`h-2 w-2 rounded-full ${
                                          it.is_paid ? "bg-emerald-500" : "bg-amber-500"
                                        }`}
                                      />
                                      {it.is_paid ? "Pago" : "Pendente"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editando && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !salvandoNome && setEditando(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-bold text-gray-800">Renomear folha</h4>
            <input
              type="text"
              value={novoNome}
              autoFocus
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !salvandoNome) salvarNome();
              }}
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Nome da folha"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditando(null)}
                disabled={salvandoNome}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvarNome}
                disabled={salvandoNome}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {salvandoNome ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FolhasPagamentoVT;
