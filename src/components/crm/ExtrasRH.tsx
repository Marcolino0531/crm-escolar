import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useSchool } from "@/lib/app-context";
import { escolaAtivaId } from "@/lib/unidade-global";
import { SelecioneUnidade } from "@/components/SelecioneUnidade";
import { criarExtra, editarExtra, listarExtras, removerExtra } from "@/lib/rh-extras.functions";
import { MENSAGEM_EXTRA_DUPLICADO, nomeExtraDuplicado, type Extra } from "@/lib/rh-extras";

interface ExtrasRHProps {
  // canEdit("rh.pessoal.extras")
  podeEditar: boolean;
}

const msgErro = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);

// RH > Pessoal > Extras: pessoas avulsas do colégio selecionado no topo.
const ExtrasRH: React.FC<ExtrasRHProps> = ({ podeEditar }) => {
  const { selected, schools } = useSchool();
  const schoolId = escolaAtivaId(selected, schools);
  const qc = useQueryClient();
  const listar = useServerFn(listarExtras);
  const criar = useServerFn(criarExtra);
  const editar = useServerFn(editarExtra);
  const remover = useServerFn(removerExtra);
  // null = fechado; { id: null } = novo; { id } = edição.
  const [form, setForm] = useState<{ id: string | null; nome: string } | null>(null);

  const extras = useQuery({
    queryKey: ["rh-extras", schoolId],
    enabled: !!schoolId,
    queryFn: async () => listar({ data: { schoolId: schoolId as string } }),
  });
  const lista = extras.data ?? [];
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["rh-extras", schoolId] });
    void qc.invalidateQueries({ queryKey: ["rh-valores-mensais", schoolId] });
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (!schoolId || !form) throw new Error("Selecione uma unidade específica.");
      const nome = form.nome.trim();
      if (!nome) throw new Error("Informe o nome completo.");
      if (nomeExtraDuplicado(lista, nome, form.id ?? undefined)) {
        throw new Error(MENSAGEM_EXTRA_DUPLICADO);
      }
      if (form.id) await editar({ data: { id: form.id, nomeCompleto: nome } });
      else await criar({ data: { schoolId, nomeCompleto: nome } });
    },
    onSuccess: () => {
      toast.success(form?.id ? "Extra atualizado." : "Extra cadastrado.");
      setForm(null);
      invalidar();
    },
    onError: (e) => toast.error(msgErro(e, "Não foi possível salvar.")),
  });

  const inativar = useMutation({
    mutationFn: async (id: string) => remover({ data: { id } }),
    onSuccess: () => {
      toast.success("Extra removido.");
      invalidar();
    },
    onError: (e) => toast.error(msgErro(e, "Não foi possível remover.")),
  });

  if (!schoolId) return <SelecioneUnidade acao="Ver e cadastrar Extras" />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">{lista.length} Extra(s) cadastrado(s)</p>
        {podeEditar && (
          <button
            type="button"
            onClick={() => setForm({ id: null, nome: "" })}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-md transition-colors hover:from-emerald-700 hover:to-teal-700"
          >
            <Plus className="h-4 w-4" />
            Novo Extra
          </button>
        )}
      </div>

      {extras.isLoading ? (
        <p className="py-10 text-center text-sm text-gray-400">Carregando…</p>
      ) : extras.isError ? (
        <p className="py-10 text-center text-sm text-red-600">
          {msgErro(extras.error, "Erro ao carregar.")}
        </p>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <UserPlus className="mb-3 h-10 w-10" />
          <p className="text-lg font-medium">Nenhum Extra cadastrado</p>
          {podeEditar && <p className="text-sm">Clique em "Novo Extra" para começar.</p>}
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3 text-left">Nome completo</th>
                <th className="px-4 py-3 text-left">Incluído por</th>
                {podeEditar && <th className="px-4 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((e: Extra) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-800">{e.nomeCompleto}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {e.criadoPor || "—"}
                    {e.criadoEm && ` · ${new Date(e.criadoEm).toLocaleDateString("pt-BR")}`}
                  </td>
                  {podeEditar && (
                    <td className="space-x-3 px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setForm({ id: e.id, nome: e.nomeCompleto })}
                        className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={inativar.isPending}
                        onClick={() => {
                          if (window.confirm(`Remover ${e.nomeCompleto}?`)) inativar.mutate(e.id);
                        }}
                        className="text-xs font-medium text-red-400 hover:text-red-600 disabled:opacity-50"
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
      )}

      {form && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !salvar.isPending && setForm(null)}
        >
          <form
            className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-lg"
            onClick={(ev) => ev.stopPropagation()}
            onSubmit={(ev) => {
              ev.preventDefault();
              salvar.mutate();
            }}
          >
            <h4 className="text-sm font-bold text-gray-800">
              {form.id ? "Editar Extra" : "Novo Extra"}
            </h4>
            <label className="block text-xs text-gray-600">
              Nome completo
              <input
                type="text"
                required
                autoFocus
                value={form.nome}
                onChange={(ev) => setForm({ ...form, nome: ev.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setForm(null)}
                disabled={salvar.isPending}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvar.isPending}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {salvar.isPending ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default ExtrasRH;
