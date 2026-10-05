import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { parseBRLNumber } from "@/lib/currency";
import { toTitleCase } from "@/lib/name-format";
import {
  competenciaAtual,
  historicoValorMensal,
  rotuloCompetencia,
  totalDoBloco,
  validarSalario,
  valorMensalVigente,
  type TipoPessoaPagamento,
  type ValorMensalRegistro,
} from "@/lib/rh-salario";
import {
  excluirValorMensal,
  salvarValorMensal,
  type PessoaPagamento,
} from "@/lib/rh-salario.functions";
import { SeletorCompetencia } from "@/components/crm/SalariosRH";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
const paraInput = (n: number | null) =>
  n == null
    ? ""
    : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type PessoaSelecionada = { tipo: TipoPessoaPagamento; id: string };

export const chaveValoresMensais = (schoolId: string | null) => ["rh-valores-mensais", schoolId];

// Bloco "Terceirizados" ou "Extras" da tela Salário base vigente.
export const BlocoValores: React.FC<{
  titulo: string;
  tipo: TipoPessoaPagamento;
  pessoas: readonly PessoaPagamento[];
  registros: readonly ValorMensalRegistro[];
  competencia: string;
  selecionada: PessoaSelecionada | null;
  onSelecionar: (p: PessoaSelecionada) => void;
}> = ({ titulo, tipo, pessoas, registros, competencia, selecionada, onSelecionar }) => {
  const comAtividade = tipo === "terceirizado";
  const linhas = useMemo(
    () =>
      pessoas
        .map((p) => ({ ...p, nome: toTitleCase(p.nome) }))
        .sort((a, b) => collator.compare(a.nome, b.nome)),
    [pessoas],
  );
  const total = totalDoBloco(
    pessoas.map((p) => ({ id: p.id, ativo: true })),
    registros,
    tipo,
    competencia,
  );
  const colunas = comAtividade ? 4 : 3;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">{titulo}</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="text-left px-4 py-2">Nome</th>
            {comAtividade && <th className="text-left px-4 py-2">Atividade</th>}
            <th className="text-right px-4 py-2">Valor</th>
            <th className="text-left px-4 py-2">Desde</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((p) => {
            const v = valorMensalVigente(registros, tipo, p.id, competencia);
            const ativa = selecionada?.tipo === tipo && selecionada.id === p.id;
            return (
              <tr
                key={p.id}
                onClick={() => onSelecionar({ tipo, id: p.id })}
                className={`border-t border-gray-100 cursor-pointer hover:bg-emerald-50 ${
                  ativa ? "bg-emerald-50" : ""
                }`}
              >
                <td className="px-4 py-2 font-medium text-gray-800">{p.nome}</td>
                {comAtividade && <td className="px-4 py-2 text-gray-500">{p.atividade || "—"}</td>}
                <td className="px-4 py-2 text-right tabular-nums">
                  {!v ? (
                    <span className="text-gray-400">—</span>
                  ) : v.valor > 0 ? (
                    brl(v.valor)
                  ) : (
                    <span className="text-gray-400">Encerrado</span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {v ? rotuloCompetencia(v.competencia) : "—"}
                </td>
              </tr>
            );
          })}
          {linhas.length === 0 && (
            <tr>
              <td colSpan={colunas} className="px-4 py-6 text-center text-gray-400">
                Nenhum ativo no colégio.
              </td>
            </tr>
          )}
        </tbody>
        {linhas.length > 0 && (
          <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-700">
            <tr>
              <td className="px-4 py-2" colSpan={comAtividade ? 2 : 1}>
                Total
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{brl(total)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

// Painel lateral de Terceirizado/Extra: competência, valor, observação e histórico.
export const PainelValorMensal: React.FC<{
  schoolId: string | null;
  tipo: TipoPessoaPagamento;
  pessoa: PessoaPagamento;
  registros: readonly ValorMensalRegistro[];
  podeEditar: boolean;
}> = ({ schoolId, tipo, pessoa, registros, podeEditar }) => {
  const qc = useQueryClient();
  const salvar = useServerFn(salvarValorMensal);
  const excluir = useServerFn(excluirValorMensal);
  const [competencia, setCompetencia] = useState(() => competenciaAtual());
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const invalidar = () => void qc.invalidateQueries({ queryKey: chaveValoresMensais(schoolId) });

  const historico = historicoValorMensal(registros, tipo, pessoa.id);
  const vigente = valorMensalVigente(registros, tipo, pessoa.id, competencia);
  const proprio = vigente?.competencia === competencia;
  useEffect(() => {
    setValor(paraInput(vigente?.valor ?? null));
    setObs(proprio ? (vigente?.observacao ?? "") : "");
  }, [vigente, proprio]);

  const gravar = useMutation({
    mutationFn: async () => {
      const input = { competencia, valor: parseBRLNumber(valor) };
      const erros = validarSalario(input);
      const msg = erros.competencia ?? erros.valor;
      if (msg) throw new Error(msg);
      return salvar({ data: { tipo, pessoaId: pessoa.id, ...input, observacao: obs } });
    },
    onSuccess: () => {
      toast.success("Valor salvo.");
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

  return (
    <>
      <h3 className="text-sm font-semibold text-gray-700">{toTitleCase(pessoa.nome)}</h3>
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
              <SeletorCompetencia value={competencia} onChange={setCompetencia} />
            </div>
          </div>
          <label className="block text-xs text-gray-500">
            Valor (R$)
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
            />
          </label>
          {vigente && !proprio && (
            <p className="text-[11px] text-amber-700">
              Sem registro em {rotuloCompetencia(competencia)}: valor repetido de{" "}
              {rotuloCompetencia(vigente.competencia)}. Ajuste e salve para criar esta competência.
            </p>
          )}
          <label className="block text-xs text-gray-500">
            Observação (opcional)
            <input
              value={obs}
              onChange={(e) => setObs(e.target.value)}
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
              : proprio
                ? `Atualizar ${rotuloCompetencia(competencia)}`
                : `Salvar ${rotuloCompetencia(competencia)}`}
          </button>
          <p className="text-[11px] text-gray-400">
            O valor vale a partir da competência e se repete nos meses seguintes até outro registro.
            Valor zero encerra.
          </p>
        </form>
      )}
      <div>
        <h4 className="text-xs uppercase text-gray-500 mb-1">Histórico</h4>
        {historico.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum valor cadastrado.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {historico.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2 py-1.5">
                <div>
                  <span className="font-medium text-gray-700">
                    {rotuloCompetencia(r.competencia)}
                  </span>
                  <span className="ml-2 tabular-nums">{brl(r.valor)}</span>
                  {r.valor === 0 && <span className="ml-2 text-xs text-gray-500">encerra</span>}
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
                      if (confirm(`Excluir o valor de ${rotuloCompetencia(r.competencia)}?`))
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
  );
};
