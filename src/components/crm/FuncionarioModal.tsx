import React, { useState } from "react";
import {
  Unidade,
  Funcionario,
  Genero,
  EstadoCivil,
  TipoFalta,
  CategoriaFalta,
} from "@/lib/crm/types";
import { UNIDADES } from "@/lib/crm/constants";

interface FuncionarioModalProps {
  unidadeSelecionada: Unidade;
  funcionarioExistente?: Funcionario;
  onSalvar: (dados: Omit<Funcionario, "id" | "ferias" | "faltas" | "criadoEm" | "schoolId">) => void;
  onFechar: () => void;
  onAdicionarFerias?: (funcionarioId: string, dataInicio: string, dataFim: string) => void;
  onRemoverFerias?: (funcionarioId: string, feriasId: string) => void;
  onAdicionarFalta?: (
    funcionarioId: string,
    data: string,
    tipo: TipoFalta,
    categoria: CategoriaFalta,
    duracaoMinutos?: number,
  ) => void;
  onRemoverFalta?: (funcionarioId: string, faltaId: string) => void;
  isAdmin?: boolean;
}

const TIPO_FALTA_OPCOES: { valor: TipoFalta; label: string }[] = [
  { valor: "com_atestado", label: "Com Atestado" },
  { valor: "sem_atestado", label: "Sem Atestado" },
];

const tipoFaltaLabel = (t: TipoFalta): string =>
  TIPO_FALTA_OPCOES.find((o) => o.valor === t)?.label ?? "";

const CATEGORIA_FALTA_OPCOES: { valor: CategoriaFalta; label: string }[] = [
  { valor: "integral", label: "Falta Integral" },
  { valor: "atraso", label: "Atraso" },
  { valor: "saida_antecipada", label: "Saída Antecipada" },
];

const categoriaFaltaLabel = (c: CategoriaFalta): string =>
  CATEGORIA_FALTA_OPCOES.find((o) => o.valor === c)?.label ?? "";

const formatarDuracao = (minutos: number): string => {
  if (!minutos || minutos <= 0) return "";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h > 0 && m > 0) return `${h}h${String(m).padStart(2, "0")}`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
};

const aplicarMascaraData = (valor: string) => {
  const nums = valor.replace(/\D/g, "").slice(0, 8);
  if (nums.length <= 2) return nums;
  if (nums.length <= 4) return `${nums.slice(0, 2)}/${nums.slice(2)}`;
  return `${nums.slice(0, 2)}/${nums.slice(2, 4)}/${nums.slice(4)}`;
};

const aplicarMascaraHora = (valor: string) => {
  const nums = valor.replace(/\D/g, "").slice(0, 4);
  if (nums.length <= 2) return nums;
  return `${nums.slice(0, 2)}:${nums.slice(2)}`;
};

const aplicarMascaraCPF = (valor: string) => {
  const nums = valor.replace(/\D/g, "").slice(0, 11);
  if (nums.length <= 3) return nums;
  if (nums.length <= 6) return `${nums.slice(0, 3)}.${nums.slice(3)}`;
  if (nums.length <= 9) return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6)}`;
  return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6, 9)}-${nums.slice(9)}`;
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

const validarHora = (hora: string): boolean => {
  if (hora.length !== 5) return false;
  const partes = hora.split(":");
  if (partes.length !== 2) return false;
  const [h, m] = partes.map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
};

// Valor monetário do VT: aceita vírgula ou ponto como separador decimal.
const parseVt = (v: string): number => {
  const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const vtValido = (v: string): boolean => {
  if (!v.trim()) return false;
  const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0;
};

const GENERO_OPCOES: { valor: Genero; label: string }[] = [
  { valor: "feminino", label: "Feminino" },
  { valor: "masculino", label: "Masculino" },
  { valor: "outro", label: "Outro" },
  { valor: "prefiro-nao-informar", label: "Prefiro não informar" },
];

const ESTADO_CIVIL_OPCOES: { valor: EstadoCivil; label: string }[] = [
  { valor: "solteiro", label: "Solteiro(a)" },
  { valor: "casado", label: "Casado(a)" },
  { valor: "divorciado", label: "Divorciado(a)" },
  { valor: "viuvo", label: "Viúvo(a)" },
  { valor: "outro", label: "Outro" },
];

const FuncionarioModal: React.FC<FuncionarioModalProps> = ({
  unidadeSelecionada,
  funcionarioExistente,
  onSalvar,
  onFechar,
  onAdicionarFerias,
  onRemoverFerias,
  onAdicionarFalta,
  onRemoverFalta,
  isAdmin = true,
}) => {
  const isEdicao = !!funcionarioExistente;

  const [form, setForm] = useState({
    nomeCompleto: funcionarioExistente?.nomeCompleto || "",
    cpf: funcionarioExistente?.cpf || "",
    dataNascimentoDisplay: converterParaBR(funcionarioExistente?.dataNascimento || ""),
    dataNascimento: funcionarioExistente?.dataNascimento || "",
    genero: funcionarioExistente?.genero || "",
    estadoCivil: funcionarioExistente?.estadoCivil || "",
    cargo: funcionarioExistente?.cargo || "",
    unidade: funcionarioExistente?.unidade || unidadeSelecionada,
    dataAdmissaoDisplay: converterParaBR(funcionarioExistente?.dataAdmissao || ""),
    dataAdmissao: funcionarioExistente?.dataAdmissao || "",
    dataInicioDisplay: converterParaBR(funcionarioExistente?.dataInicio || ""),
    dataInicio: funcionarioExistente?.dataInicio || "",
    dataRescisaoDisplay: converterParaBR(funcionarioExistente?.dataRescisao || ""),
    dataRescisao: funcionarioExistente?.dataRescisao || "",
    horarioTrabalhoInicio: funcionarioExistente?.horarioTrabalhoInicio || "",
    horarioTrabalhoFim: funcionarioExistente?.horarioTrabalhoFim || "",
    horarioAlmocoInicio: funcionarioExistente?.horarioAlmocoInicio || "",
    horarioAlmocoFim: funcionarioExistente?.horarioAlmocoFim || "",
    recebeVt: funcionarioExistente?.recebeVt ?? true,
    valorDiarioVt:
      funcionarioExistente?.valorDiarioVt != null ? String(funcionarioExistente.valorDiarioVt) : "",
  });

  const [feriasForm, setFeriasForm] = useState({
    dataInicioDisplay: "",
    dataInicio: "",
    dataFimDisplay: "",
    dataFim: "",
  });
  const [mostrarFeriasForm, setMostrarFeriasForm] = useState(false);

  const [faltaForm, setFaltaForm] = useState<{
    dataDisplay: string;
    data: string;
    tipo: TipoFalta;
    categoria: CategoriaFalta;
    duracao: string;
  }>({
    dataDisplay: "",
    data: "",
    tipo: "sem_atestado",
    categoria: "integral",
    duracao: "",
  });
  const [mostrarFaltaForm, setMostrarFaltaForm] = useState(false);

  const handleFaltaDataChange = (valor: string) => {
    const display = aplicarMascaraData(valor);
    if (display.length === 10 && validarData(display)) {
      setFaltaForm((prev) => ({ ...prev, dataDisplay: display, data: converterParaISO(display) }));
    } else {
      setFaltaForm((prev) => ({ ...prev, dataDisplay: display, data: "" }));
    }
  };

  const handleAdicionarFalta = () => {
    if (funcionarioExistente && onAdicionarFalta && faltaForm.data) {
      const duracaoMinutos =
        faltaForm.categoria === "integral"
          ? undefined
          : parseInt(faltaForm.duracao, 10) || undefined;
      onAdicionarFalta(
        funcionarioExistente.id,
        faltaForm.data,
        faltaForm.tipo,
        faltaForm.categoria,
        duracaoMinutos,
      );
      setFaltaForm({ dataDisplay: "", data: "", tipo: "sem_atestado", categoria: "integral", duracao: "" });
      setMostrarFaltaForm(false);
    }
  };

  const handleDataChange = (
    campo: "dataAdmissao" | "dataRescisao" | "dataInicio" | "dataNascimento",
    valor: string,
  ) => {
    const display = aplicarMascaraData(valor);
    const displayKey = `${campo}Display` as
      | "dataAdmissaoDisplay"
      | "dataRescisaoDisplay"
      | "dataInicioDisplay"
      | "dataNascimentoDisplay";
    if (display.length === 10 && validarData(display)) {
      setForm((prev) => ({ ...prev, [displayKey]: display, [campo]: converterParaISO(display) }));
    } else {
      setForm((prev) => ({ ...prev, [displayKey]: display, [campo]: "" }));
    }
  };

  const handleHoraChange = (campo: string, valor: string) => {
    const masked = aplicarMascaraHora(valor);
    setForm((prev) => ({ ...prev, [campo]: masked }));
  };

  const handleCPFChange = (valor: string) => {
    const masked = aplicarMascaraCPF(valor);
    setForm((prev) => ({ ...prev, cpf: masked }));
  };

  const handleFeriasDataChange = (campo: "dataInicio" | "dataFim", valor: string) => {
    const display = aplicarMascaraData(valor);
    const displayKey = `${campo}Display` as "dataInicioDisplay" | "dataFimDisplay";
    if (display.length === 10 && validarData(display)) {
      setFeriasForm((prev) => ({
        ...prev,
        [displayKey]: display,
        [campo]: converterParaISO(display),
      }));
    } else {
      setFeriasForm((prev) => ({ ...prev, [displayKey]: display, [campo]: "" }));
    }
  };

  const handleAdicionarFerias = () => {
    if (funcionarioExistente && onAdicionarFerias && feriasForm.dataInicio && feriasForm.dataFim) {
      onAdicionarFerias(funcionarioExistente.id, feriasForm.dataInicio, feriasForm.dataFim);
      setFeriasForm({ dataInicioDisplay: "", dataInicio: "", dataFimDisplay: "", dataFim: "" });
      setMostrarFeriasForm(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !form.nomeCompleto.trim() ||
      !form.cpf.trim() ||
      !form.genero ||
      !form.estadoCivil ||
      !form.dataNascimento ||
      !form.dataInicio ||
      !validarHora(form.horarioTrabalhoInicio) ||
      !validarHora(form.horarioTrabalhoFim) ||
      (form.recebeVt && !vtValido(form.valorDiarioVt))
    ) {
      return;
    }
    onSalvar({
      nomeCompleto: form.nomeCompleto,
      cpf: form.cpf,
      dataNascimento: form.dataNascimento,
      genero: form.genero as Genero,
      estadoCivil: form.estadoCivil as EstadoCivil,
      cargo: form.cargo || undefined,
      unidade: form.unidade as Unidade,
      dataAdmissao: form.dataAdmissao || undefined,
      dataInicio: form.dataInicio,
      dataRescisao: form.dataRescisao || undefined,
      horarioTrabalhoInicio: form.horarioTrabalhoInicio,
      horarioTrabalhoFim: form.horarioTrabalhoFim,
      horarioAlmocoInicio: form.horarioAlmocoInicio || undefined,
      horarioAlmocoFim: form.horarioAlmocoFim || undefined,
      recebeVt: form.recebeVt,
      valorDiarioVt: form.recebeVt ? parseVt(form.valorDiarioVt) : 0,
    });
  };

  const formValido =
    form.nomeCompleto.trim() &&
    form.cpf.trim() &&
    form.genero &&
    form.estadoCivil &&
    form.dataNascimento &&
    form.dataInicio &&
    validarHora(form.horarioTrabalhoInicio) &&
    validarHora(form.horarioTrabalhoFim) &&
    (!form.recebeVt || vtValido(form.valorDiarioVt));

  const inputClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">👤</span>
              <h2 className="text-white text-lg font-bold">
                {isEdicao ? "Detalhes do Funcionário" : "Novo Funcionário"}
              </h2>
            </div>
            <button onClick={onFechar} className="text-white/80 hover:text-white transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Nome Completo - full width */}
          <div>
            <label className={labelClass}>
              Nome Completo <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.nomeCompleto}
              onChange={(e) => setForm((prev) => ({ ...prev, nomeCompleto: e.target.value }))}
              placeholder="Ex: João da Silva"
              className={inputClass}
            />
          </div>

          {/* CPF + Cargo */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>
                CPF <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.cpf}
                onChange={(e) => handleCPFChange(e.target.value)}
                placeholder="000.000.000-00"
                maxLength={14}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Cargo</label>
              <input
                type="text"
                value={form.cargo}
                onChange={(e) => setForm((prev) => ({ ...prev, cargo: e.target.value }))}
                placeholder="Ex: Professor"
                className={inputClass}
              />
            </div>
          </div>

          {/* Gênero + Estado Civil */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>
                Gênero <span className="text-red-500">*</span>
              </label>
              <select
                value={form.genero}
                onChange={(e) => setForm((prev) => ({ ...prev, genero: e.target.value }))}
                className={inputClass}
              >
                <option value="">Selecione...</option>
                {GENERO_OPCOES.map((op) => (
                  <option key={op.valor} value={op.valor}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                Estado Civil <span className="text-red-500">*</span>
              </label>
              <select
                value={form.estadoCivil}
                onChange={(e) => setForm((prev) => ({ ...prev, estadoCivil: e.target.value }))}
                className={inputClass}
              >
                <option value="">Selecione...</option>
                {ESTADO_CIVIL_OPCOES.map((op) => (
                  <option key={op.valor} value={op.valor}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Unidade - full width */}
          <div>
            <label className={labelClass}>
              Unidade <span className="text-red-500">*</span>
            </label>
            <select
              value={form.unidade}
              onChange={(e) => setForm((prev) => ({ ...prev, unidade: e.target.value as Unidade }))}
              className={inputClass}
            >
              {UNIDADES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {/* Data de Nascimento + Data de Início */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>
                Data de Nascimento <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.dataNascimentoDisplay}
                onChange={(e) => handleDataChange("dataNascimento", e.target.value)}
                placeholder="DD/MM/AAAA"
                maxLength={10}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                Data de Início <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.dataInicioDisplay}
                onChange={(e) => handleDataChange("dataInicio", e.target.value)}
                placeholder="DD/MM/AAAA"
                maxLength={10}
                className={inputClass}
              />
            </div>
          </div>

          {/* Data de Admissão + Data de Rescisão */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Data de Admissão</label>
              <input
                type="text"
                value={form.dataAdmissaoDisplay}
                onChange={(e) => handleDataChange("dataAdmissao", e.target.value)}
                placeholder="DD/MM/AAAA"
                maxLength={10}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Data de Rescisão</label>
              <input
                type="text"
                value={form.dataRescisaoDisplay}
                onChange={(e) => handleDataChange("dataRescisao", e.target.value)}
                placeholder="DD/MM/AAAA"
                maxLength={10}
                className={inputClass}
              />
            </div>
          </div>

          {/* Horário de Trabalho */}
          <div>
            <label className={labelClass}>
              Horário de Trabalho <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={form.horarioTrabalhoInicio}
                onChange={(e) => handleHoraChange("horarioTrabalhoInicio", e.target.value)}
                placeholder="08:00"
                maxLength={5}
                className={`flex-1 ${inputClass}`}
              />
              <span className="text-gray-500 text-sm">às</span>
              <input
                type="text"
                value={form.horarioTrabalhoFim}
                onChange={(e) => handleHoraChange("horarioTrabalhoFim", e.target.value)}
                placeholder="17:00"
                maxLength={5}
                className={`flex-1 ${inputClass}`}
              />
            </div>
          </div>

          {/* Horário de Almoço (OPTIONAL - no asterisk) */}
          <div>
            <label className={labelClass}>Horário de Almoço</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={form.horarioAlmocoInicio}
                onChange={(e) => handleHoraChange("horarioAlmocoInicio", e.target.value)}
                placeholder="12:00"
                maxLength={5}
                className={`flex-1 ${inputClass}`}
              />
              <span className="text-gray-500 text-sm">às</span>
              <input
                type="text"
                value={form.horarioAlmocoFim}
                onChange={(e) => handleHoraChange("horarioAlmocoFim", e.target.value)}
                placeholder="13:00"
                maxLength={5}
                className={`flex-1 ${inputClass}`}
              />
            </div>
          </div>

          {/* Elegibilidade ao Vale-Transporte */}
          <div>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className={labelClass + " mb-0"}>Recebe Vale-Transporte?</span>
              <button
                type="button"
                role="switch"
                aria-checked={form.recebeVt}
                onClick={() => setForm({ ...form, recebeVt: !form.recebeVt })}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                  form.recebeVt ? "bg-emerald-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    form.recebeVt ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </label>

            {form.recebeVt && (
              <div className="mt-3">
                <label className={labelClass}>
                  Valor Diário do VT <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.valorDiarioVt}
                    onChange={(e) => setForm({ ...form, valorDiarioVt: e.target.value })}
                    placeholder="0,00"
                    className={`${inputClass} pl-9`}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Valor por dia usado no Fechamento de Vale-Transporte.</p>
              </div>
            )}
          </div>

          {/* Controle de Férias (somente no modo edição) */}
          {isEdicao && funcionarioExistente && (
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <span>🏖️</span> Controle de Férias
                </h3>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setMostrarFeriasForm(!mostrarFeriasForm)}
                    className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 font-medium transition-colors"
                  >
                    + Adicionar Férias
                  </button>
                )}
              </div>

              {mostrarFeriasForm && (
                <div className="bg-emerald-50 rounded-lg p-3 mb-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Data de Início</label>
                      <input
                        type="text"
                        value={feriasForm.dataInicioDisplay}
                        onChange={(e) => handleFeriasDataChange("dataInicio", e.target.value)}
                        placeholder="DD/MM/AAAA"
                        maxLength={10}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Data de Fim</label>
                      <input
                        type="text"
                        value={feriasForm.dataFimDisplay}
                        onChange={(e) => handleFeriasDataChange("dataFim", e.target.value)}
                        placeholder="DD/MM/AAAA"
                        maxLength={10}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMostrarFeriasForm(false)}
                      className="text-xs px-3 py-1 text-gray-500 hover:text-gray-700"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleAdicionarFerias}
                      disabled={!feriasForm.dataInicio || !feriasForm.dataFim}
                      className="text-xs px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              )}

              {funcionarioExistente.ferias.length === 0 ? (
                <p className="text-xs text-gray-400 italic">Nenhum período de férias registrado.</p>
              ) : (
                <div className="space-y-2">
                  {funcionarioExistente.ferias.map((periodo) => (
                    <div
                      key={periodo.id}
                      className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                    >
                      <span className="text-sm text-gray-700">
                        📅 {converterParaBR(periodo.dataInicio)} →{" "}
                        {converterParaBR(periodo.dataFim)}
                      </span>
                      {isAdmin && onRemoverFerias && (
                        <button
                          type="button"
                          onClick={() => onRemoverFerias(funcionarioExistente.id, periodo.id)}
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Controle de Faltas (somente no modo edição) */}
          {isEdicao && funcionarioExistente && (
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <span>📋</span> Controle de Faltas
                </h3>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setMostrarFaltaForm(!mostrarFaltaForm)}
                    className="text-xs px-3 py-1.5 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 font-medium transition-colors"
                  >
                    + Adicionar Falta
                  </button>
                )}
              </div>

              {mostrarFaltaForm && (
                <div className="bg-amber-50 rounded-lg p-3 mb-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Data</label>
                      <input
                        type="text"
                        value={faltaForm.dataDisplay}
                        onChange={(e) => handleFaltaDataChange(e.target.value)}
                        placeholder="DD/MM/AAAA"
                        maxLength={10}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Ocorrência</label>
                      <select
                        value={faltaForm.categoria}
                        onChange={(e) =>
                          setFaltaForm((prev) => ({
                            ...prev,
                            categoria: e.target.value as CategoriaFalta,
                            duracao: e.target.value === "integral" ? "" : prev.duracao,
                          }))
                        }
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
                      >
                        {CATEGORIA_FALTA_OPCOES.map((o) => (
                          <option key={o.valor} value={o.valor}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Tipo</label>
                      <select
                        value={faltaForm.tipo}
                        onChange={(e) =>
                          setFaltaForm((prev) => ({ ...prev, tipo: e.target.value as TipoFalta }))
                        }
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
                      >
                        {TIPO_FALTA_OPCOES.map((o) => (
                          <option key={o.valor} value={o.valor}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {faltaForm.categoria !== "integral" && (
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Tempo de Ausência (min)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={faltaForm.duracao}
                          onChange={(e) =>
                            setFaltaForm((prev) => ({ ...prev, duracao: e.target.value }))
                          }
                          placeholder="Ex: 30"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMostrarFaltaForm(false)}
                      className="text-xs px-3 py-1 text-gray-500 hover:text-gray-700"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleAdicionarFalta}
                      disabled={!faltaForm.data}
                      className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              )}

              {funcionarioExistente.faltas.length === 0 ? (
                <p className="text-xs text-gray-400 italic">Nenhuma falta registrada.</p>
              ) : (
                <div className="space-y-2">
                  {[...funcionarioExistente.faltas]
                    .sort((a, b) => b.data.localeCompare(a.data))
                    .map((falta) => (
                      <div
                        key={falta.id}
                        className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                      >
                        <span className="text-sm text-gray-700 flex items-center gap-2 flex-wrap">
                          📅 {converterParaBR(falta.data)}
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-sky-100 text-sky-700">
                            {categoriaFaltaLabel(falta.categoria ?? "integral")}
                            {falta.duracaoMinutos
                              ? ` · ${formatarDuracao(falta.duracaoMinutos)}`
                              : ""}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              falta.tipo === "com_atestado"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {tipoFaltaLabel(falta.tipo)}
                          </span>
                        </span>
                        {isAdmin && onRemoverFalta && (
                          <button
                            type="button"
                            onClick={() => onRemoverFalta(funcionarioExistente.id, falta.id)}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            Excluir
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onFechar}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              {isEdicao ? "Fechar" : "Cancelar"}
            </button>
            {(!isEdicao || isAdmin) && (
              <button
                type="submit"
                disabled={!formValido}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 transition-colors text-sm font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isEdicao ? "Salvar Alterações" : "Cadastrar Funcionário"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default FuncionarioModal;
