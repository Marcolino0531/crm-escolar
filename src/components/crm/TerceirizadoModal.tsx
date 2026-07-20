import React, { useState } from "react";
import { X, Trash2, Sun, Sunset, CalendarDays } from "lucide-react";
import type { DiaSemana, GradeTurnos, Terceirizado, Turno, TurnoFalta } from "@/lib/crm/types";
import {
  DIAS_SEMANA,
  TURNOS,
  gradeVazia,
  turnosDaFalta,
  type TerceirizadoFormData,
} from "@/lib/crm/terceirizados";

interface TerceirizadoModalProps {
  unidadeSelecionada: string;
  unidades: string[];
  terceirizadoExistente?: Terceirizado;
  onSalvar: (dados: TerceirizadoFormData) => void;
  onFechar: () => void;
  onAdicionarFalta?: (id: string, data: string, turno: TurnoFalta, observacao?: string) => void;
  onRemoverFalta?: (id: string, faltaId: string) => void;
  isAdmin?: boolean;
}

const aplicarMascaraData = (valor: string) => {
  const nums = valor.replace(/\D/g, "").slice(0, 8);
  if (nums.length <= 2) return nums;
  if (nums.length <= 4) return `${nums.slice(0, 2)}/${nums.slice(2)}`;
  return `${nums.slice(0, 2)}/${nums.slice(2, 4)}/${nums.slice(4)}`;
};

const converterParaISO = (dataBR: string): string => {
  const partes = dataBR.split("/");
  if (partes.length !== 3 || partes[2].length !== 4) return "";
  const [dia, mes, ano] = partes;
  return `${ano}-${mes}-${dia}`;
};

const converterParaBR = (dataISO: string): string => {
  if (!dataISO) return "";
  const partes = dataISO.split("-");
  if (partes.length !== 3) return "";
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
};

const validarData = (dataBR: string): boolean => {
  if (dataBR.length !== 10) return false;
  const partes = dataBR.split("/");
  if (partes.length !== 3) return false;
  const [dia, mes, ano] = partes.map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1900) return false;
  const d = new Date(ano, mes - 1, dia);
  return d.getDate() === dia && d.getMonth() === mes - 1 && d.getFullYear() === ano;
};

const parseValor = (v: string): number => {
  const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const fmtBRL = (n: number): string =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// getDay(): 0 Dom … 6 Sáb → índice em DIAS_SEMANA (seg=0 … sex=4); null no fim de semana.
const DIA_POR_GETDAY: Record<number, DiaSemana | undefined> = {
  1: "seg",
  2: "ter",
  3: "qua",
  4: "qui",
  5: "sex",
};

const diaSemanaDaISO = (iso: string): DiaSemana | null => {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return DIA_POR_GETDAY[d.getDay()] ?? null;
};

const TURNO_FALTA_LABEL: Record<TurnoFalta, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  dia: "Dia completo",
};

const TerceirizadoModal: React.FC<TerceirizadoModalProps> = ({
  unidadeSelecionada,
  unidades,
  terceirizadoExistente,
  onSalvar,
  onFechar,
  onAdicionarFalta,
  onRemoverFalta,
  isAdmin = true,
}) => {
  const isEdicao = !!terceirizadoExistente;

  const [form, setForm] = useState({
    nomeCompleto: terceirizadoExistente?.nomeCompleto || "",
    especialidade: terceirizadoExistente?.especialidade || "",
    telefone: terceirizadoExistente?.telefone || "",
    unidade: terceirizadoExistente?.unidade || unidadeSelecionada,
    valorTurno:
      terceirizadoExistente?.valorTurno != null && terceirizadoExistente.valorTurno > 0
        ? String(terceirizadoExistente.valorTurno)
        : "",
  });
  const [grade, setGrade] = useState<GradeTurnos>(terceirizadoExistente?.grade ?? gradeVazia());

  const [faltaForm, setFaltaForm] = useState<{
    dataDisplay: string;
    data: string;
    turno: TurnoFalta;
  }>({
    dataDisplay: "",
    data: "",
    turno: "dia",
  });

  const toggleGrade = (dia: DiaSemana, turno: Turno) => {
    setGrade((prev) => ({
      ...prev,
      [dia]: { ...prev[dia], [turno]: !prev[dia][turno] },
    }));
  };

  const handleFaltaDataChange = (valor: string) => {
    const display = aplicarMascaraData(valor);
    const iso = display.length === 10 && validarData(display) ? converterParaISO(display) : "";
    setFaltaForm((prev) => ({ ...prev, dataDisplay: display, data: iso }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nomeCompleto.trim() || !form.especialidade.trim()) return;
    onSalvar({
      unidade: form.unidade,
      nomeCompleto: form.nomeCompleto.trim(),
      especialidade: form.especialidade.trim(),
      telefone: form.telefone.trim() || undefined,
      valorTurno: parseValor(form.valorTurno),
      grade,
    });
  };

  // Turnos permitidos na data escolhida = turnos que existem na grade daquele dia.
  const diaFalta = diaSemanaDaISO(faltaForm.data);
  const gradeDoDia = diaFalta ? grade[diaFalta] : null;
  const opcoesFalta: { valor: TurnoFalta; label: string }[] = (() => {
    if (!gradeDoDia) return [];
    const opcoes: { valor: TurnoFalta; label: string }[] = [];
    if (gradeDoDia.manha) opcoes.push({ valor: "manha", label: "Manhã" });
    if (gradeDoDia.tarde) opcoes.push({ valor: "tarde", label: "Tarde" });
    if (gradeDoDia.manha && gradeDoDia.tarde) opcoes.push({ valor: "dia", label: "Dia completo" });
    return opcoes;
  })();

  // Mantém o turno selecionado coerente com as opções disponíveis.
  const turnoSelecionado = opcoesFalta.some((o) => o.valor === faltaForm.turno)
    ? faltaForm.turno
    : (opcoesFalta[0]?.valor ?? "dia");

  const podeRegistrarFalta = !!faltaForm.data && opcoesFalta.length > 0;

  const handleAdicionarFalta = () => {
    if (!terceirizadoExistente || !onAdicionarFalta || !podeRegistrarFalta) return;
    onAdicionarFalta(terceirizadoExistente.id, faltaForm.data, turnoSelecionado);
    setFaltaForm({ dataDisplay: "", data: "", turno: "dia" });
  };

  const faltas = terceirizadoExistente?.faltas ?? [];
  const faltasOrdenadas = [...faltas].sort((a, b) => b.data.localeCompare(a.data));
  const totalTurnosFaltados = faltas.reduce((acc, f) => acc + turnosDaFalta(f.turno), 0);
  const valorTurnoNum = parseValor(form.valorTurno);
  const descontoTotal = totalTurnosFaltados * valorTurnoNum;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4">
          <h2 className="text-lg font-bold text-white">
            {isEdicao ? "Terceirizado" : "Novo Terceirizado"}
          </h2>
          <button
            type="button"
            onClick={onFechar}
            className="text-white/80 transition-colors hover:text-white"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="terceirizado-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Nome completo *
                </label>
                <input
                  type="text"
                  value={form.nomeCompleto}
                  onChange={(e) => setForm((p) => ({ ...p, nomeCompleto: e.target.value }))}
                  disabled={!isAdmin}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-gray-100"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Atividade / Especialidade *
                </label>
                <input
                  type="text"
                  value={form.especialidade}
                  onChange={(e) => setForm((p) => ({ ...p, especialidade: e.target.value }))}
                  disabled={!isAdmin}
                  placeholder="Balé, Capoeira, Robótica…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-gray-100"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Telefone</label>
                <input
                  type="text"
                  value={form.telefone}
                  onChange={(e) => setForm((p) => ({ ...p, telefone: e.target.value }))}
                  disabled={!isAdmin}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-gray-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Unidade</label>
                <select
                  value={form.unidade}
                  onChange={(e) => setForm((p) => ({ ...p, unidade: e.target.value }))}
                  disabled={!isAdmin || isEdicao}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-gray-100"
                >
                  {unidades.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Valor por turno (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.valorTurno}
                  onChange={(e) => setForm((p) => ({ ...p, valorTurno: e.target.value }))}
                  disabled={!isAdmin}
                  placeholder="0,00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-gray-100"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Usado para calcular o desconto por falta.
                </p>
              </div>
            </div>

            {/* Grade semanal por turnos */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Grade semanal (turnos)
              </label>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 text-xs uppercase text-gray-500">
                      <th className="px-3 py-2 text-left">Dia</th>
                      {TURNOS.map((t) => (
                        <th key={t.id} className="px-3 py-2 text-center">
                          {t.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {DIAS_SEMANA.map((dia) => (
                      <tr key={dia.id}>
                        <td className="px-3 py-2 text-sm font-medium text-gray-700">{dia.label}</td>
                        {TURNOS.map((t) => (
                          <td key={t.id} className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={grade[dia.id][t.id]}
                              onChange={() => toggleGrade(dia.id, t.id)}
                              disabled={!isAdmin}
                              className="h-4 w-4 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </form>

          {/* Apontamento de faltas (só na edição) */}
          {isEdicao && (
            <div className="mt-6 border-t border-gray-200 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">Apontamento de faltas</h3>
                <div className="text-right text-xs text-gray-500">
                  <div>{totalTurnosFaltados} turno(s) de falta</div>
                  {valorTurnoNum > 0 && (
                    <div className="font-semibold text-red-600">
                      Desconto: {fmtBRL(descontoTotal)}
                    </div>
                  )}
                </div>
              </div>

              {isAdmin && onAdicionarFalta && (
                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        Data (seg a sex)
                      </label>
                      <input
                        type="text"
                        value={faltaForm.dataDisplay}
                        onChange={(e) => handleFaltaDataChange(e.target.value)}
                        placeholder="dd/mm/aaaa"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-xs font-medium text-gray-600">Turno</label>
                      <select
                        value={turnoSelecionado}
                        onChange={(e) =>
                          setFaltaForm((p) => ({ ...p, turno: e.target.value as TurnoFalta }))
                        }
                        disabled={!podeRegistrarFalta}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-gray-100"
                      >
                        {opcoesFalta.length === 0 ? (
                          <option value="dia">—</option>
                        ) : (
                          opcoesFalta.map((o) => (
                            <option key={o.valor} value={o.valor}>
                              {o.label}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleAdicionarFalta}
                      disabled={!podeRegistrarFalta}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Lançar falta
                    </button>
                  </div>
                  {faltaForm.data && opcoesFalta.length === 0 && (
                    <p className="mt-2 text-xs text-amber-600">
                      Sem turnos na grade para esse dia da semana. Ajuste a grade acima ou escolha
                      outra data.
                    </p>
                  )}
                </div>
              )}

              {faltasOrdenadas.length === 0 ? (
                <p className="text-sm italic text-gray-400">Nenhuma falta lançada.</p>
              ) : (
                <div className="space-y-2">
                  {faltasOrdenadas.map((f) => {
                    const Icon =
                      f.turno === "manha" ? Sun : f.turno === "tarde" ? Sunset : CalendarDays;
                    return (
                      <div
                        key={f.id}
                        className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-700">
                            {converterParaBR(f.data)}
                          </span>
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                            {TURNO_FALTA_LABEL[f.turno]}
                          </span>
                        </div>
                        {isAdmin && onRemoverFalta && (
                          <button
                            type="button"
                            onClick={() => onRemoverFalta(terceirizadoExistente.id, f.id)}
                            className="text-red-400 transition-colors hover:text-red-600"
                            aria-label="Remover falta"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Fechar
          </button>
          {isAdmin && (
            <button
              type="submit"
              form="terceirizado-form"
              className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-medium text-white shadow-md transition-colors hover:from-emerald-700 hover:to-teal-700"
            >
              {isEdicao ? "Salvar alterações" : "Cadastrar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TerceirizadoModal;
