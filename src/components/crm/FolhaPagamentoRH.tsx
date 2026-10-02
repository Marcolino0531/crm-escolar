import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { Funcionario } from "@/lib/crm/types";
import { useRole } from "@/lib/app-context";
import { parseBRLNumber } from "@/lib/currency";
import { competenciaAtual, rotuloCompetencia, salarioVigente } from "@/lib/rh-salario";
import { listarSalarios } from "@/lib/rh-salario.functions";
import type { FolhaExtrato, ColaboradorExtrato, TipoRubrica } from "@/lib/extrato-mensal";
import { lerExtratoMensalPdf } from "@/lib/extrato-mensal.pdf";
import {
  ROTULO_DIVERGENCIA,
  ROTULO_STATUS,
  compararFolhas,
  montarLoteFolha,
  planejarReimportacao,
  preSelecao,
  restituicoesDaCompetencia,
  totaisAjustados,
  totaisResumo,
  type ComparacaoFolhas,
  type Divergencia,
  type LinhaResumo,
  type PlanoReimportacao,
  type RubricaFolha,
} from "@/lib/folha-pagamento";
import {
  ajustarColaboradorFolha,
  confirmarColaboradoresFolha,
  fecharCompetenciaFolha,
  gravarImportacaoFolha,
  listarCompetenciasFolha,
  listarMarcacoesRestituicao,
  marcarRestituicaoInss,
  obterFolhaCompetencia,
  prepararImportacaoFolha,
  reabrirCompetenciaFolha,
  reabrirConferenciaFolha,
  vincularFuncionarioFolha,
  type ColaboradorFolhaGravado,
} from "@/lib/rh-folha.functions";
import SalariosRH, { SeletorCompetencia } from "@/components/crm/SalariosRH";

interface FolhaPagamentoRHProps {
  schoolId: string | null;
  funcionarios: Funcionario[];
  podeEditar: boolean;
  onFolhaSalva?: () => void;
}

type Secao = "folha" | "restituicao" | "resumo";
const SECOES: { id: Secao; label: string }[] = [
  { id: "folha", label: "Folha" },
  { id: "restituicao", label: "Restituição" },
  { id: "resumo", label: "Resumo" },
];

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
const msgErro = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
const paraInput = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const valorDivergencia = (v: string | number | null) =>
  v == null ? "—" : typeof v === "number" ? brl(v) : v;

const ListaDivergencias: React.FC<{ divergencias: readonly Divergencia[] }> = ({ divergencias }) =>
  divergencias.length === 0 ? (
    <span className="text-xs text-gray-400">Sem divergência</span>
  ) : (
    <ul className="space-y-0.5 text-xs">
      {divergencias.map((d, i) => (
        <li key={i} className="text-amber-800">
          <span className="font-medium">{ROTULO_DIVERGENCIA[d.tipo]}</span>
          {d.rubrica && <span className="text-gray-600"> · {d.rubrica}</span>}
          {d.tipo !== "novo" && (
            <span className="tabular-nums">
              {" "}
              · antes {valorDivergencia(d.antes)} → depois {valorDivergencia(d.depois)}
              {d.diferenca != null && (
                <span className={d.diferenca < 0 ? " text-red-700" : " text-emerald-700"}>
                  {" "}
                  ({d.diferenca > 0 ? "+" : ""}
                  {brl(d.diferenca)})
                </span>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

const SeloStatus: React.FC<{ status: LinhaResumo["status"] }> = ({ status }) => {
  const cls =
    status === "confirmado"
      ? "bg-emerald-100 text-emerald-800"
      : status === "em_conferencia"
        ? "bg-amber-100 text-amber-900"
        : "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {ROTULO_STATUS[status]}
    </span>
  );
};

// ---------- Importação (conferência antes de gravar) ----------

type Preparo = {
  folha: FolhaExtrato;
  cnpjColegio: string;
  cnpjDivergente: boolean;
  anteriorCompetencia: string | null;
  comparacao: ComparacaoFolhas<ColaboradorExtrato> | null;
  plano: PlanoReimportacao<ColaboradorExtrato> | null;
};

const ModalImportacao: React.FC<{
  preparo: Preparo;
  gravando: boolean;
  onCancelar: () => void;
  onGravar: (selecionados: string[], confirmarCnpj: boolean) => void;
}> = ({ preparo, gravando, onCancelar, onGravar }) => {
  const { folha, comparacao, plano } = preparo;
  const [selecionados, setSelecionados] = useState<Set<string>>(() =>
    comparacao ? preSelecao(comparacao) : new Set(),
  );
  const [confirmarCnpj, setConfirmarCnpj] = useState(false);
  const alternar = (codigo: string) =>
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(codigo)) n.delete(codigo);
      else n.add(codigo);
      return n;
    });

  const linhas: { c: ColaboradorExtrato; divergencias: Divergencia[]; aviso?: string }[] = plano
    ? [
        ...plano.substituidos.map((s) => ({
          c: s.colaborador,
          divergencias: s.divergencias,
          aviso: s.perdeAjusteManual ? "O ajuste manual gravado será perdido." : undefined,
        })),
        ...plano.novos.map((c) => ({
          c,
          divergencias: [{ tipo: "novo" as const, antes: null, depois: c.nome, diferenca: null }],
        })),
      ]
    : (comparacao?.porColaborador ?? []).map((p) => ({
        c: p.colaborador,
        divergencias: p.divergencias,
      }));
  const bloqueado = preparo.cnpjDivergente && !confirmarCnpj;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-lg">
        <div className="border-b border-gray-100 px-4 py-3">
          <h4 className="text-sm font-bold text-gray-800">
            Conferência do Extrato Mensal — {rotuloCompetencia(folha.competencia)}
          </h4>
          <p className="text-xs text-gray-500">
            {folha.empresa} · CNPJ {folha.cnpj} · {folha.colaboradores.length} colaborador(es) ·
            proventos {brl(folha.totalProventos)} · descontos {brl(folha.totalDescontos)} · líquido{" "}
            {brl(folha.liquidoGeral)}
          </p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {preparo.cnpjDivergente && (
            <div className="rounded-lg border-2 border-red-400 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-bold">CNPJ do PDF diferente do CNPJ do colégio selecionado.</p>
              <p>
                PDF: <b>{folha.cnpj || "vazio"}</b> · Colégio:{" "}
                <b>{preparo.cnpjColegio || "não cadastrado"}</b>
              </p>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmarCnpj}
                  onChange={(e) => setConfirmarCnpj(e.target.checked)}
                />
                Confirmo que esta folha é deste colégio.
              </label>
            </div>
          )}
          {plano ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">Reimportação da mesma competência.</p>
              <p>
                {plano.iguais.length} igual(is) ao gravado (nada muda) · {plano.substituidos.length}{" "}
                serão substituído(s) · {plano.novos.length} novo(s) · {plano.retirados.length}{" "}
                sai(em) da folha.
              </p>
              <p>
                Os substituídos e novos voltam para "Em conferência", salvo os selecionados abaixo.
              </p>
              {plano.retirados.length > 0 && (
                <p>Saem da folha: {plano.retirados.map((r) => r.nome).join(", ")}</p>
              )}
            </div>
          ) : comparacao?.primeiraImportacao ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <span>
                Primeira importação deste colégio: não há competência anterior para comparar.
              </span>
              <button
                type="button"
                onClick={() => setSelecionados(new Set(folha.colaboradores.map((c) => c.codigo)))}
                className="rounded-md border border-blue-300 bg-white px-2 py-1 font-medium"
              >
                Selecionar todos
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              Comparado com {rotuloCompetencia(preparo.anteriorCompetencia ?? "")}. Quem não tem
              divergência vem selecionado.
            </p>
          )}
          {linhas.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum colaborador mudou em relação ao gravado.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2 text-left">Colaborador</th>
                  <th className="px-2 py-2 text-right">Bruto</th>
                  <th className="px-2 py-2 text-right">Líquido</th>
                  <th className="px-2 py-2 text-left">Divergências</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ c, divergencias, aviso }) => (
                  <tr
                    key={c.codigo}
                    className={`border-t border-gray-100 align-top ${
                      divergencias.length ? "bg-amber-50" : ""
                    }`}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selecionados.has(c.codigo)}
                        onChange={() => alternar(c.codigo)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <span className="font-medium text-gray-800">{c.nome}</span>
                      <span className="block text-xs text-gray-500">
                        {c.codigo} · {c.tipo === "contribuinte" ? "Contribuinte" : "Empregado"} ·{" "}
                        {c.situacao}
                      </span>
                      {aviso && <span className="block text-xs text-red-700">{aviso}</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{brl(c.proventos)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{brl(c.liquido)}</td>
                    <td className="px-2 py-2">
                      <ListaDivergencias divergencias={divergencias} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {comparacao && comparacao.ausentes.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-3 text-xs">
              <p className="font-semibold text-gray-700">
                Estavam na folha de {rotuloCompetencia(preparo.anteriorCompetencia ?? "")} e não
                estão nesta ({comparacao.ausentes.length}):
              </p>
              <p className="text-gray-600">{comparacao.ausentes.map((a) => a.nome).join(", ")}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
          <span className="text-xs text-gray-500">
            {selecionados.size} selecionado(s) para confirmar. Todos os lidos são gravados.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancelar}
              disabled={gravando}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onGravar([...selecionados], confirmarCnpj)}
              disabled={gravando || bloqueado}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {gravando ? "Gravando…" : "Gravar e confirmar selecionados"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- Ajuste manual ----------

type RubricaManualEdicao = { tipo: TipoRubrica; codigo: string; descricao: string; valor: string };

type DadosAjuste = {
  observacao: string;
  pdf: { ordem: number; valor: number; removida: boolean }[];
  manuais: { tipo: TipoRubrica; codigo: string; descricao: string; valor: number }[];
};

const ModalAjuste: React.FC<{
  colaborador: ColaboradorFolhaGravado;
  salvando: boolean;
  onCancelar: () => void;
  onSalvar: (dados: DadosAjuste) => void;
}> = ({ colaborador, salvando, onCancelar, onSalvar }) => {
  const doPdf = colaborador.rubricas.filter((r) => r.origem === "pdf");
  const [pdf, setPdf] = useState(() =>
    doPdf.map((r) => ({ ordem: r.ordem, valor: paraInput(r.valor), removida: r.removida })),
  );
  const [manuais, setManuais] = useState<RubricaManualEdicao[]>(() =>
    colaborador.rubricas
      .filter((r) => r.origem === "manual")
      .map((r) => ({
        tipo: r.tipo,
        codigo: r.codigo,
        descricao: r.descricao,
        valor: paraInput(r.valor),
      })),
  );
  const [observacao, setObservacao] = useState("");

  const rubricasEditadas: RubricaFolha[] = [
    ...doPdf.map((r, i) => ({
      ...r,
      valor: parseBRLNumber(pdf[i].valor) || 0,
      removida: pdf[i].removida,
    })),
    ...manuais.map((m) => ({
      tipo: m.tipo,
      codigo: m.codigo,
      descricao: m.descricao,
      referencia: "",
      valor: parseBRLNumber(m.valor) || 0,
      origem: "manual" as const,
      valorOriginal: null,
      removida: false,
    })),
  ];
  const t = totaisAjustados(rubricasEditadas);

  const salvar = () => {
    if (!observacao.trim()) {
      toast.error("A observação do ajuste é obrigatória.");
      return;
    }
    if (manuais.some((m) => !m.descricao.trim())) {
      toast.error("Informe a descrição de cada rubrica incluída.");
      return;
    }
    onSalvar({
      observacao: observacao.trim(),
      pdf: pdf.map((p) => ({
        ordem: p.ordem,
        valor: parseBRLNumber(p.valor) || 0,
        removida: p.removida,
      })),
      manuais: manuais.map((m) => ({
        tipo: m.tipo,
        codigo: m.codigo.trim(),
        descricao: m.descricao.trim(),
        valor: parseBRLNumber(m.valor) || 0,
      })),
    });
  };

  const cls = "w-full rounded-md border border-gray-300 px-2 py-1 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-lg">
        <div className="border-b border-gray-100 px-4 py-3">
          <h4 className="text-sm font-bold text-gray-800">Ajustar — {colaborador.nome}</h4>
          <p className="text-xs text-gray-500">
            Os valores originais do PDF ficam guardados e aparecem ao lado.
          </p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-2 py-1 text-left">Rubrica</th>
                <th className="px-2 py-1 text-right">Original (PDF)</th>
                <th className="px-2 py-1 text-right">Valor</th>
                <th className="px-2 py-1 text-center">Remover</th>
              </tr>
            </thead>
            <tbody>
              {doPdf.map((r, i) => (
                <tr
                  key={r.ordem}
                  className={`border-t border-gray-100 ${pdf[i].removida ? "opacity-50" : ""}`}
                >
                  <td className="px-2 py-1">
                    {r.tipo} {r.codigo} {r.descricao}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-500">
                    {r.valorOriginal != null ? brl(r.valorOriginal) : "—"}
                  </td>
                  <td className="w-32 px-2 py-1">
                    <input
                      inputMode="decimal"
                      value={pdf[i].valor}
                      disabled={pdf[i].removida}
                      onChange={(e) =>
                        setPdf((ps) =>
                          ps.map((p, j) => (j === i ? { ...p, valor: e.target.value } : p)),
                        )
                      }
                      className={`${cls} text-right`}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={pdf[i].removida}
                      onChange={(e) =>
                        setPdf((ps) =>
                          ps.map((p, j) => (j === i ? { ...p, removida: e.target.checked } : p)),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-500">Rubricas incluídas</p>
            {manuais.map((m, i) => {
              const set = (patch: Partial<RubricaManualEdicao>) =>
                setManuais((ms) => ms.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div
                  key={i}
                  className="grid grid-cols-[5rem_6rem_1fr_8rem_auto] items-center gap-2"
                >
                  <select
                    value={m.tipo}
                    onChange={(e) => set({ tipo: e.target.value === "D" ? "D" : "P" })}
                    className={cls}
                  >
                    <option value="P">Provento</option>
                    <option value="D">Desconto</option>
                  </select>
                  <input
                    placeholder="Código"
                    value={m.codigo}
                    onChange={(e) => set({ codigo: e.target.value })}
                    className={cls}
                  />
                  <input
                    placeholder="Descrição"
                    value={m.descricao}
                    onChange={(e) => set({ descricao: e.target.value })}
                    className={cls}
                  />
                  <input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={m.valor}
                    onChange={(e) => set({ valor: e.target.value })}
                    className={`${cls} text-right`}
                  />
                  <button
                    type="button"
                    onClick={() => setManuais((ms) => ms.filter((_, j) => j !== i))}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remover
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                setManuais((ms) => [...ms, { tipo: "P", codigo: "", descricao: "", valor: "" }])
              }
              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              Incluir rubrica
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-2 text-xs tabular-nums">
            <span>
              Proventos: <b>{brl(t.proventos)}</b>{" "}
              <span className="text-gray-500">(PDF {brl(colaborador.proventosPdf)})</span>
            </span>
            <span>
              Descontos: <b>{brl(t.descontos)}</b>{" "}
              <span className="text-gray-500">(PDF {brl(colaborador.descontosPdf)})</span>
            </span>
            <span>
              Líquido: <b>{brl(t.liquido)}</b>{" "}
              <span className="text-gray-500">(PDF {brl(colaborador.liquidoPdf)})</span>
            </span>
          </div>
          <label className="block text-xs text-gray-600">
            Observação (obrigatória)
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              className={`mt-1 ${cls}`}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={salvando}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {salvando ? "Salvando…" : "Salvar ajuste"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------- Tela ----------

function useAcao<T>(fn: (v: T) => Promise<unknown>, ok: string, depois: () => void) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(ok);
      depois();
    },
    onError: (e) => toast.error(msgErro(e, "Não foi possível concluir.")),
  });
}

const FolhaPagamentoRH: React.FC<FolhaPagamentoRHProps> = ({
  schoolId,
  funcionarios,
  podeEditar,
  onFolhaSalva,
}) => {
  const qc = useQueryClient();
  const { isAdmin } = useRole();
  const [secao, setSecao] = useState<Secao>("folha");
  const [competencia, setCompetenciaState] = useState(() => competenciaAtual());
  const escolhida = useRef(false);
  const setCompetencia = (c: string) => {
    escolhida.current = true;
    setCompetenciaState(c);
  };

  const fnCompetencias = useServerFn(listarCompetenciasFolha);
  const fnObter = useServerFn(obterFolhaCompetencia);
  const fnPreparar = useServerFn(prepararImportacaoFolha);
  const fnGravar = useServerFn(gravarImportacaoFolha);
  const fnConfirmar = useServerFn(confirmarColaboradoresFolha);
  const fnReabrirConferencia = useServerFn(reabrirConferenciaFolha);
  const fnAjustar = useServerFn(ajustarColaboradorFolha);
  const fnVincular = useServerFn(vincularFuncionarioFolha);
  const fnFechar = useServerFn(fecharCompetenciaFolha);
  const fnReabrir = useServerFn(reabrirCompetenciaFolha);
  const fnMarcacoes = useServerFn(listarMarcacoesRestituicao);
  const fnMarcar = useServerFn(marcarRestituicaoInss);
  const fnSalarios = useServerFn(listarSalarios);

  const competencias = useQuery({
    queryKey: ["rh-folha-competencias", schoolId],
    enabled: !!schoolId,
    queryFn: async () => fnCompetencias({ data: { schoolId: schoolId as string } }),
  });
  useEffect(() => {
    const ultima = competencias.data?.[0]?.competencia;
    if (ultima && !escolhida.current) setCompetenciaState(ultima);
  }, [competencias.data]);

  const folhaQ = useQuery({
    queryKey: ["rh-folha", schoolId, competencia],
    enabled: !!schoolId,
    queryFn: async () => fnObter({ data: { schoolId: schoolId as string, competencia } }),
  });
  const marcacoesQ = useQuery({
    queryKey: ["rh-folha-marcacoes", schoolId],
    enabled: !!schoolId,
    queryFn: async () => fnMarcacoes({ data: { schoolId: schoolId as string } }),
  });
  const salariosQ = useQuery({
    queryKey: ["rh-salarios", schoolId],
    enabled: !!schoolId,
    queryFn: async () => fnSalarios({ data: { schoolId } }),
  });

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["rh-folha", schoolId] });
    void qc.invalidateQueries({ queryKey: ["rh-folha-competencias", schoolId] });
    void qc.invalidateQueries({ queryKey: ["rh-salarios", schoolId] });
  };

  const importacao = folhaQ.data?.importacao ?? null;
  const colaboradores = useMemo(
    () => [...(folhaQ.data?.colaboradores ?? [])].sort((a, b) => collator.compare(a.nome, b.nome)),
    [folhaQ.data],
  );
  const fechada = importacao?.status === "fechada";
  const editavel = podeEditar && !!importacao && !fechada;
  const pendentes = colaboradores.filter((c) => c.status === "em_conferencia");
  const porId = useMemo(() => new Map(funcionarios.map((f) => [f.id, f])), [funcionarios]);
  const ordenados = useMemo(
    () => [...funcionarios].sort((a, b) => collator.compare(a.nomeCompleto, b.nomeCompleto)),
    [funcionarios],
  );
  const naFolha = useMemo(
    () => new Set(colaboradores.flatMap((c) => (c.funcionarioId ? [c.funcionarioId] : []))),
    [colaboradores],
  );
  const ativosForaDaFolha = ordenados.filter((f) => !f.dataRescisao && !naFolha.has(f.id));

  const marcados = useMemo(
    () => new Set((marcacoesQ.data ?? []).filter((m) => m.recebe).map((m) => m.funcionarioId)),
    [marcacoesQ.data],
  );
  const restituicao = useMemo(
    () => restituicoesDaCompetencia(colaboradores, marcados, fechada),
    [colaboradores, marcados, fechada],
  );

  const linhasResumo = useMemo((): LinhaResumo[] => {
    const restPorId = new Map(restituicao.linhas.map((l) => [l.id, l.restituicao]));
    const daFolha: LinhaResumo[] = colaboradores.map((c) => ({
      chave: c.id,
      funcionarioId: c.funcionarioId,
      nome: c.nome,
      status: c.status,
      bruto: c.proventos,
      liquido: c.liquido,
      restituicao: restPorId.get(c.id) ?? 0,
    }));
    const registros = salariosQ.data ?? [];
    const manuais: LinhaResumo[] = ativosForaDaFolha.flatMap((f) => {
      const v = salarioVigente(registros, f.id, competencia);
      if (!v) return [];
      return [
        {
          chave: f.id,
          funcionarioId: f.id,
          nome: f.nomeCompleto,
          status: "manual" as const,
          bruto: v.valor,
          liquido: v.valorLiquido ?? v.valor,
          restituicao: 0,
        },
      ];
    });
    return [...daFolha, ...manuais];
  }, [colaboradores, restituicao, salariosQ.data, ativosForaDaFolha, competencia]);
  const totais = totaisResumo(linhasResumo);
  const lote = useMemo(
    () => (importacao ? montarLoteFolha(linhasResumo) : null),
    [importacao, linhasResumo],
  );

  // ----- Importação -----
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [preparo, setPreparo] = useState<Preparo | null>(null);

  const lerArquivo = async (arquivo: File) => {
    if (!schoolId) return;
    setLendo(true);
    try {
      const folha = await lerExtratoMensalPdf(arquivo);
      const prep = await fnPreparar({
        data: { schoolId, competencia: folha.competencia, cnpj: folha.cnpj },
      });
      if (prep.gravada?.status === "fechada") {
        throw new Error(
          `A competência ${rotuloCompetencia(folha.competencia)} está fechada e não aceita reimportação.`,
        );
      }
      setPreparo({
        folha,
        cnpjColegio: prep.cnpjColegio,
        cnpjDivergente: prep.cnpjDivergente,
        anteriorCompetencia: prep.anterior?.competencia ?? null,
        comparacao: prep.gravada
          ? null
          : compararFolhas(prep.anterior?.colaboradores ?? null, folha.colaboradores),
        plano: prep.gravada
          ? planejarReimportacao(prep.gravada.colaboradores, folha.colaboradores)
          : null,
      });
    } catch (e) {
      toast.error(msgErro(e, "Não foi possível ler o PDF."), { duration: 15000 });
    } finally {
      setLendo(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  };

  const gravar = useMutation({
    mutationFn: async (v: { selecionados: string[]; confirmarCnpj: boolean }) => {
      if (!schoolId || !preparo) throw new Error("Selecione uma unidade específica.");
      return fnGravar({ data: { schoolId, folha: preparo.folha, ...v } });
    },
    onSuccess: (r) => {
      toast.success(
        `Folha gravada: ${r.gravados} colaborador(es) gravado(s), ${r.iguais} sem mudança.`,
      );
      if (preparo) setCompetencia(preparo.folha.competencia);
      setPreparo(null);
      recarregar();
    },
    onError: (e) => toast.error(msgErro(e, "Não foi possível gravar a folha.")),
  });

  // ----- Ações da folha -----
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [soConferencia, setSoConferencia] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ajustando, setAjustando] = useState<ColaboradorFolhaGravado | null>(null);
  useEffect(() => setSelecionados(new Set()), [competencia, schoolId]);

  const base = { schoolId: schoolId as string, competencia };
  const confirmar = useAcao(
    async (ids: string[]) => fnConfirmar({ data: { ...base, ids } }),
    "Colaborador(es) confirmado(s).",
    recarregar,
  );
  const reabrirConferencia = useAcao(
    async (id: string) => fnReabrirConferencia({ data: { ...base, id } }),
    "Conferência reaberta.",
    recarregar,
  );
  const vincular = useAcao(
    async (v: { id: string; funcionarioId: string | null }) =>
      fnVincular({ data: { ...base, ...v } }),
    "Vínculo atualizado.",
    recarregar,
  );
  const fechar = useAcao(
    async (_: null) => fnFechar({ data: base }),
    "Competência fechada.",
    recarregar,
  );
  const reabrir = useAcao(
    async (_: null) => fnReabrir({ data: base }),
    "Competência reaberta.",
    recarregar,
  );
  const ajustar = useMutation({
    mutationFn: async (v: { id: string } & DadosAjuste) => fnAjustar({ data: { ...base, ...v } }),
    onSuccess: () => {
      toast.success("Ajuste salvo.");
      setAjustando(null);
      recarregar();
    },
    onError: (e) => toast.error(msgErro(e, "Não foi possível salvar o ajuste.")),
  });
  const marcar = useMutation({
    mutationFn: async (v: { funcionarioId: string; recebe: boolean }) =>
      fnMarcar({ data: { schoolId: schoolId as string, ...v } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rh-folha-marcacoes", schoolId] }),
    onError: (e) => toast.error(msgErro(e, "Não foi possível atualizar a marcação.")),
  });

  if (!schoolId) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Selecione uma unidade específica no seletor do topo para ver a folha de pagamento.
      </div>
    );
  }

  const visiveis = soConferencia ? pendentes : colaboradores;
  const funcionariosLivres = (atual: string | null) =>
    ordenados.filter((f) => f.id === atual || !naFolha.has(f.id));

  const cabecalho = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
        {SECOES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSecao(s.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              secao === s.id
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Competência
          <SeletorCompetencia value={competencia} onChange={setCompetencia} compacto />
        </label>
        {importacao && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              fechada ? "bg-gray-200 text-gray-700" : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {fechada ? "Fechada" : "Aberta"}
          </span>
        )}
        {pendentes.length > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
            {pendentes.length} em conferência
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {cabecalho}
      {folhaQ.isError && (
        <p className="text-sm text-red-600">{msgErro(folhaQ.error, "Erro ao carregar a folha.")}</p>
      )}

      {secao === "folha" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="text-xs text-gray-500">
              {importacao ? (
                <>
                  {importacao.empresa} · CNPJ {importacao.cnpj} · {importacao.calculo} · importada
                  por {importacao.importadoPorNome} em {dataHora(importacao.importadoEm)}
                  {importacao.reimportadoEm &&
                    ` · reimportada por ${importacao.reimportadoPorNome} em ${dataHora(importacao.reimportadoEm)}`}
                  {importacao.fechadoEm &&
                    ` · fechada por ${importacao.fechadoPorNome} em ${dataHora(importacao.fechadoEm)}`}
                  {importacao.cnpjDivergente && (
                    <span className="ml-1 font-semibold text-red-700">
                      (CNPJ diferente do colégio: {importacao.cnpjColegio || "não cadastrado"})
                    </span>
                  )}
                </>
              ) : folhaQ.isLoading ? (
                "Carregando…"
              ) : (
                `Nenhuma folha importada em ${rotuloCompetencia(competencia)}.`
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {podeEditar && !fechada && (
                <>
                  <input
                    ref={arquivoRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void lerArquivo(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => arquivoRef.current?.click()}
                    disabled={lendo}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {lendo ? "Lendo PDF…" : "Importar Extrato Mensal (PDF)"}
                  </button>
                </>
              )}
              {editavel && selecionados.size > 0 && (
                <button
                  type="button"
                  onClick={() => confirmar.mutate([...selecionados])}
                  disabled={confirmar.isPending}
                  className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Confirmar selecionados ({selecionados.size})
                </button>
              )}
              {editavel && (
                <button
                  type="button"
                  disabled={pendentes.length > 0 || fechar.isPending}
                  title={pendentes.length ? "Ainda há colaboradores Em conferência." : undefined}
                  onClick={() => {
                    if (
                      confirm(
                        `Fechar a competência ${rotuloCompetencia(competencia)}? Ela fica somente leitura.`,
                      )
                    )
                      fechar.mutate(null);
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Fechar competência
                </button>
              )}
              {fechada && isAdmin && (
                <button
                  type="button"
                  disabled={reabrir.isPending}
                  onClick={() => {
                    if (confirm(`Reabrir a competência ${rotuloCompetencia(competencia)}?`))
                      reabrir.mutate(null);
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Reabrir competência
                </button>
              )}
            </div>
          </div>

          {importacao && (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-2 text-xs">
                <label className="flex items-center gap-2 text-gray-600">
                  <input
                    type="checkbox"
                    checked={soConferencia}
                    onChange={(e) => setSoConferencia(e.target.checked)}
                  />
                  Só em conferência
                </label>
                <span className="tabular-nums text-gray-600">
                  {colaboradores.length} colaborador(es) · proventos{" "}
                  {brl(importacao.totalProventos)} · descontos {brl(importacao.totalDescontos)} ·
                  líquido {brl(importacao.liquidoGeral)}
                </span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="w-8 px-2 py-2">
                      {editavel && pendentes.length > 0 && (
                        <input
                          type="checkbox"
                          checked={selecionados.size === pendentes.length}
                          onChange={(e) =>
                            setSelecionados(
                              e.target.checked ? new Set(pendentes.map((c) => c.id)) : new Set(),
                            )
                          }
                        />
                      )}
                    </th>
                    <th className="px-2 py-2 text-left">Colaborador</th>
                    <th className="px-2 py-2 text-left">Cadastro no RH</th>
                    <th className="px-2 py-2 text-right">Proventos</th>
                    <th className="px-2 py-2 text-right">Descontos</th>
                    <th className="px-2 py-2 text-right">Líquido</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((c) => {
                    const ajustado = c.ajustadoEm != null;
                    return (
                      <React.Fragment key={c.id}>
                        <tr
                          className={`border-t border-gray-100 align-top ${
                            c.status === "em_conferencia" ? "bg-amber-50" : ""
                          }`}
                        >
                          <td className="px-2 py-2">
                            {editavel && c.status === "em_conferencia" && (
                              <input
                                type="checkbox"
                                checked={selecionados.has(c.id)}
                                onChange={() =>
                                  setSelecionados((s) => {
                                    const n = new Set(s);
                                    if (n.has(c.id)) n.delete(c.id);
                                    else n.add(c.id);
                                    return n;
                                  })
                                }
                              />
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => setAberto(aberto === c.id ? null : c.id)}
                              className="text-left font-medium text-gray-800 hover:underline"
                            >
                              {c.nome}
                            </button>
                            <span className="block text-xs text-gray-500">
                              {c.codigo} ·{" "}
                              {c.tipo === "contribuinte" ? "Contribuinte" : "Empregado"} ·{" "}
                              {c.situacao}
                              {c.cargo && ` · ${c.cargo}`}
                            </span>
                            {ajustado && (
                              <span className="block text-xs text-blue-700">
                                Ajustado manualmente por {c.ajustadoPorNome} em{" "}
                                {dataHora(c.ajustadoEm)}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {editavel ? (
                              <select
                                value={c.funcionarioId ?? ""}
                                onChange={(e) =>
                                  vincular.mutate({
                                    id: c.id,
                                    funcionarioId: e.target.value || null,
                                  })
                                }
                                className={`max-w-[14rem] rounded-md border px-1 py-0.5 ${
                                  c.funcionarioId
                                    ? "border-gray-300"
                                    : "border-red-400 text-red-700"
                                }`}
                              >
                                <option value="">Sem cadastro no RH</option>
                                {funcionariosLivres(c.funcionarioId).map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.nomeCompleto}
                                    {f.dataRescisao ? " (desligado)" : ""}
                                  </option>
                                ))}
                              </select>
                            ) : c.funcionarioId ? (
                              (porId.get(c.funcionarioId)?.nomeCompleto ?? "Vinculado")
                            ) : (
                              <span className="font-medium text-red-700">Sem cadastro no RH</span>
                            )}
                            {c.vinculoManual && (
                              <span className="block text-gray-400">vínculo manual</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{brl(c.proventos)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{brl(c.descontos)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {brl(c.liquido)}
                            {ajustado && (
                              <span className="block text-xs text-gray-400">
                                PDF {brl(c.liquidoPdf)}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <SeloStatus status={c.status} />
                            {c.confirmadoEm && (
                              <span className="block text-xs text-gray-400">
                                {c.confirmadoPorNome} · {dataHora(c.confirmadoEm)}
                              </span>
                            )}
                          </td>
                          <td className="space-y-1 px-2 py-2 text-right text-xs">
                            {editavel && c.status === "em_conferencia" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => confirmar.mutate([c.id])}
                                  className="block w-full text-emerald-700 hover:underline"
                                >
                                  Confirmar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAjustando(c)}
                                  className="block w-full text-blue-700 hover:underline"
                                >
                                  Ajustar
                                </button>
                              </>
                            )}
                            {editavel && c.status === "confirmado" && (
                              <button
                                type="button"
                                onClick={() => reabrirConferencia.mutate(c.id)}
                                className="block w-full text-amber-700 hover:underline"
                              >
                                Reabrir conferência
                              </button>
                            )}
                          </td>
                        </tr>
                        {(aberto === c.id || c.status === "em_conferencia") && (
                          <tr className="border-t border-gray-50 bg-gray-50/60">
                            <td />
                            <td colSpan={7} className="px-2 py-2">
                              {c.status === "em_conferencia" && c.divergencias.length > 0 && (
                                <div className="mb-2">
                                  <ListaDivergencias divergencias={c.divergencias} />
                                </div>
                              )}
                              {aberto === c.id && (
                                <div className="grid gap-3 md:grid-cols-2">
                                  {(["P", "D"] as const).map((tipo) => (
                                    <table key={tipo} className="w-full text-xs">
                                      <thead className="text-gray-500">
                                        <tr>
                                          <th className="text-left">
                                            {tipo === "P" ? "Proventos" : "Descontos"}
                                          </th>
                                          <th className="text-right">Ref.</th>
                                          <th className="text-right">Valor</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {c.rubricas
                                          .filter((r) => r.tipo === tipo)
                                          .map((r) => (
                                            <tr
                                              key={r.ordem}
                                              className={
                                                r.removida ? "text-gray-400 line-through" : ""
                                              }
                                            >
                                              <td>
                                                {r.codigo} {r.descricao}
                                                {r.origem === "manual" && (
                                                  <span className="ml-1 text-blue-700">
                                                    (manual)
                                                  </span>
                                                )}
                                              </td>
                                              <td className="text-right">{r.referencia}</td>
                                              <td className="text-right tabular-nums">
                                                {brl(r.valor)}
                                                {r.valorOriginal != null &&
                                                  Math.round(r.valorOriginal * 100) !==
                                                    Math.round(r.valor * 100) && (
                                                    <span className="ml-1 text-gray-400">
                                                      (PDF {brl(r.valorOriginal)})
                                                    </span>
                                                  )}
                                              </td>
                                            </tr>
                                          ))}
                                      </tbody>
                                    </table>
                                  ))}
                                  {c.ajusteObservacao && (
                                    <p className="text-xs text-gray-600 md:col-span-2">
                                      Observação do ajuste: {c.ajusteObservacao}
                                    </p>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {visiveis.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                        {soConferencia ? "Ninguém em conferência." : "Nenhum colaborador."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {importacao && ativosForaDaFolha.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
              <p className="mb-1 font-semibold text-gray-700">
                Funcionários ativos do RH que não estão nesta folha ({ativosForaDaFolha.length}) —
                só informação; o salário deles continua manual (aba Resumo):
              </p>
              <p>{ativosForaDaFolha.map((f) => f.nomeCompleto).join(", ")}</p>
            </div>
          )}
        </div>
      )}

      {secao === "restituicao" && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <h3 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-700">
              Recebe restituição do INSS
            </h3>
            <ul className="divide-y divide-gray-100 text-sm">
              {ordenados.map((f) => {
                const m = marcacoesQ.data?.find((x) => x.funcionarioId === f.id);
                return (
                  <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={marcados.has(f.id)}
                        disabled={!podeEditar || marcar.isPending}
                        onChange={(e) =>
                          marcar.mutate({ funcionarioId: f.id, recebe: e.target.checked })
                        }
                      />
                      <span className={f.dataRescisao ? "text-gray-400" : "text-gray-800"}>
                        {f.nomeCompleto}
                        {f.dataRescisao ? " (desligado)" : ""}
                      </span>
                    </label>
                    {m && (
                      <span className="text-right text-[11px] text-gray-400">
                        {m.recebe ? "marcado" : "desmarcado"} por {m.atualizadoPorNome} ·{" "}
                        {dataHora(m.atualizadoEm)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <h3 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-700">
              Restituição de {rotuloCompetencia(competencia)}
              {fechada && (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  (gravada no fechamento)
                </span>
              )}
            </h3>
            {!importacao ? (
              <p className="px-4 py-6 text-sm text-gray-400">
                Nenhuma folha importada nesta competência.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Colaborador</th>
                    <th className="px-4 py-2 text-right">INSS do mês (998)</th>
                    <th className="px-4 py-2 text-right">Restituição</th>
                  </tr>
                </thead>
                <tbody>
                  {colaboradores.map((c, i) => (
                    <tr key={c.id} className="border-t border-gray-100">
                      <td className="px-4 py-2">{c.nome}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {brl(restituicao.linhas[i].inss)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {brl(restituicao.linhas[i].restituicao)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-semibold">
                  <tr>
                    <td className="px-4 py-2" colSpan={2}>
                      Total de restituição
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(restituicao.total)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {secao === "resumo" && (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <h3 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-700">
              Resumo de {rotuloCompetencia(competencia)}
            </h3>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Colaborador</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Bruto</th>
                  <th className="px-4 py-2 text-right">Líquido</th>
                  <th className="px-4 py-2 text-right">Restituição</th>
                </tr>
              </thead>
              <tbody>
                {linhasResumo.map((l) => (
                  <tr key={l.chave} className="border-t border-gray-100">
                    <td className="px-4 py-2">{l.nome}</td>
                    <td className="px-4 py-2">
                      <SeloStatus status={l.status} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(l.bruto)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(l.liquido)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(l.restituicao)}</td>
                  </tr>
                ))}
                {linhasResumo.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                      Nenhum colaborador nesta competência.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className="px-4 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{brl(totais.bruto)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{brl(totais.liquido)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{brl(totais.restituicao)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <SalariosRH
            schoolId={schoolId}
            funcionarios={funcionarios}
            podeEditar={podeEditar}
            onFolhaSalva={onFolhaSalva}
            competencia={competencia}
            onCompetenciaChange={setCompetencia}
            loteFolha={lote}
            naFolha={naFolha}
          />
        </div>
      )}

      {preparo && (
        <ModalImportacao
          preparo={preparo}
          gravando={gravar.isPending}
          onCancelar={() => setPreparo(null)}
          onGravar={(sel, confirmarCnpj) => gravar.mutate({ selecionados: sel, confirmarCnpj })}
        />
      )}
      {ajustando && (
        <ModalAjuste
          colaborador={ajustando}
          salvando={ajustar.isPending}
          onCancelar={() => setAjustando(null)}
          onSalvar={(d) => ajustar.mutate({ id: ajustando.id, ...d })}
        />
      )}
    </div>
  );
};

export default FolhaPagamentoRH;
