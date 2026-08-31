import React, { useEffect, useState } from "react";
import {
  Unidade,
  Funcionario,
  Falta,
  Genero,
  EstadoCivil,
  TipoFalta,
  CategoriaFalta,
} from "@/lib/crm/types";
import { UNIDADES } from "@/lib/crm/constants";
import { formatValorVt, parseValorVt, valorVtValido } from "@/lib/crm/vt-valor";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ATESTADOS_BUCKET = "rh-atestados";
const HR_DOCS_BUCKET = "hr-documents";

interface HrDocumento {
  id: string;
  file_name: string;
  file_url: string;
  storage_path: string | null;
  created_at: string;
}

interface FuncionarioModalProps {
  unidadeSelecionada: Unidade;
  funcionarioExistente?: Funcionario;
  onSalvar: (
    dados: Omit<Funcionario, "id" | "ferias" | "faltas" | "criadoEm" | "schoolId">,
  ) => void;
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
  onAdicionarFaltasPeriodo?: (
    funcionarioId: string,
    dataInicio: string,
    numeroDias: number,
    tipo: TipoFalta,
    categoria: CategoriaFalta,
    duracaoMinutos?: number,
  ) => void;
  onEditarFalta?: (
    funcionarioId: string,
    faltaId: string,
    patch: Partial<Omit<Falta, "id">>,
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
  onAdicionarFaltasPeriodo,
  onEditarFalta,
  onRemoverFalta,
  isAdmin = true,
}) => {
  const isEdicao = !!funcionarioExistente;

  const [form, setForm] = useState({
    nomeCompleto: funcionarioExistente?.nomeCompleto || "",
    cpf: funcionarioExistente?.cpf || "",
    email: funcionarioExistente?.email || "",
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
      funcionarioExistente?.valorDiarioVt != null
        ? formatValorVt(funcionarioExistente.valorDiarioVt)
        : "",
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
    numeroDias: string;
    tipo: TipoFalta;
    categoria: CategoriaFalta;
    duracao: string;
  }>({
    dataDisplay: "",
    data: "",
    numeroDias: "1",
    tipo: "sem_atestado",
    categoria: "integral",
    duracao: "",
  });
  const [mostrarFaltaForm, setMostrarFaltaForm] = useState(false);

  // ----- Edição de uma falta existente (modal sobreposto) -----
  const [faltaEditId, setFaltaEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    dataDisplay: string;
    data: string;
    tipo: TipoFalta;
    categoria: CategoriaFalta;
    duracao: string;
    observacao: string;
    atestadoPath?: string;
    atestadoNome?: string;
    novoArquivo: File | null;
  }>({
    dataDisplay: "",
    data: "",
    tipo: "sem_atestado",
    categoria: "integral",
    duracao: "",
    observacao: "",
    novoArquivo: null,
  });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  // ----- Documentos do funcionário (contratos, TRCTs, atestados, etc.) -----
  const [documentos, setDocumentos] = useState<HrDocumento[]>([]);
  const [docsCarregando, setDocsCarregando] = useState(false);
  const [docEnviando, setDocEnviando] = useState(false);

  const carregarDocumentos = React.useCallback(async (employeeId: string) => {
    setDocsCarregando(true);
    const { data, error } = await supabase
      .from("hr_employee_documents" as never)
      .select("id, file_name, file_url, storage_path, created_at")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    setDocsCarregando(false);
    if (error) {
      toast.error("Não foi possível carregar os documentos.");
      return;
    }
    setDocumentos((data ?? []) as unknown as HrDocumento[]);
  }, []);

  useEffect(() => {
    if (funcionarioExistente?.id) carregarDocumentos(funcionarioExistente.id);
  }, [funcionarioExistente?.id, carregarDocumentos]);

  const handleUploadDocumento = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !funcionarioExistente) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Envie um arquivo PDF.");
      return;
    }
    setDocEnviando(true);
    try {
      const path = `${funcionarioExistente.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from(HR_DOCS_BUCKET)
        .upload(path, file, { contentType: "application/pdf" });
      if (upErr) {
        toast.error(`Falha ao enviar o documento: ${upErr.message}`);
        return;
      }
      const { data: pub } = supabase.storage.from(HR_DOCS_BUCKET).getPublicUrl(path);
      const { error: insErr } = await supabase.from("hr_employee_documents" as never).insert({
        employee_id: funcionarioExistente.id,
        file_name: file.name,
        file_url: pub.publicUrl,
        storage_path: path,
      } as never);
      if (insErr) {
        await supabase.storage.from(HR_DOCS_BUCKET).remove([path]);
        toast.error(`Falha ao registrar o documento: ${insErr.message}`);
        return;
      }
      toast.success("Documento enviado.");
      await carregarDocumentos(funcionarioExistente.id);
    } finally {
      setDocEnviando(false);
    }
  };

  // Bucket privado: abre via URL assinada temporária.
  const abrirDocumento = async (doc: HrDocumento) => {
    const path = doc.storage_path;
    if (!path) {
      window.open(doc.file_url, "_blank", "noopener,noreferrer");
      return;
    }
    const { data, error } = await supabase.storage.from(HR_DOCS_BUCKET).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível abrir o documento.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const removerDocumento = async (doc: HrDocumento) => {
    if (!funcionarioExistente) return;
    if (!confirm(`Remover o documento "${doc.file_name}"?`)) return;
    if (doc.storage_path) {
      await supabase.storage.from(HR_DOCS_BUCKET).remove([doc.storage_path]);
    }
    const { error } = await supabase
      .from("hr_employee_documents" as never)
      .delete()
      .eq("id", doc.id);
    if (error) {
      toast.error("Não foi possível remover o documento.");
      return;
    }
    toast.success("Documento removido.");
    await carregarDocumentos(funcionarioExistente.id);
  };

  const abrirEdicaoFalta = (falta: Falta) => {
    setFaltaEditId(falta.id);
    setEditForm({
      dataDisplay: converterParaBR(falta.data),
      data: falta.data,
      tipo: falta.tipo,
      categoria: falta.categoria ?? "integral",
      duracao: falta.duracaoMinutos ? String(falta.duracaoMinutos) : "",
      observacao: falta.observacao ?? "",
      atestadoPath: falta.atestadoPath,
      atestadoNome: falta.atestadoNome,
      novoArquivo: null,
    });
  };

  const handleEditFaltaDataChange = (valor: string) => {
    const display = aplicarMascaraData(valor);
    if (display.length === 10 && validarData(display)) {
      setEditForm((prev) => ({ ...prev, dataDisplay: display, data: converterParaISO(display) }));
    } else {
      setEditForm((prev) => ({ ...prev, dataDisplay: display, data: "" }));
    }
  };

  // Abre o atestado (bucket privado) via URL assinada temporária.
  const abrirAtestado = async (path: string) => {
    const { data, error } = await supabase.storage.from(ATESTADOS_BUCKET).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível abrir o atestado.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleSalvarEdicaoFalta = async () => {
    if (!funcionarioExistente || !onEditarFalta || !faltaEditId || !editForm.data) return;
    setSalvandoEdicao(true);
    try {
      let atestadoPath = editForm.atestadoPath;
      let atestadoNome = editForm.atestadoNome;

      if (editForm.novoArquivo) {
        const file = editForm.novoArquivo;
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${funcionarioExistente.id}/${faltaEditId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(ATESTADOS_BUCKET)
          .upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (upErr) {
          toast.error(`Falha ao enviar o atestado: ${upErr.message}`);
          setSalvandoEdicao(false);
          return;
        }
        // Remove o anexo anterior (se houver) para não deixar órfãos.
        if (editForm.atestadoPath && editForm.atestadoPath !== path) {
          await supabase.storage.from(ATESTADOS_BUCKET).remove([editForm.atestadoPath]);
        }
        atestadoPath = path;
        atestadoNome = file.name;
      }

      const duracaoMinutos =
        editForm.categoria === "integral" ? undefined : parseInt(editForm.duracao, 10) || undefined;

      onEditarFalta(funcionarioExistente.id, faltaEditId, {
        data: editForm.data,
        tipo: editForm.tipo,
        categoria: editForm.categoria,
        duracaoMinutos,
        observacao: editForm.observacao.trim() || undefined,
        atestadoPath,
        atestadoNome,
      });
      toast.success("Falta atualizada com sucesso.");
      setFaltaEditId(null);
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const removerAnexoEdicao = async () => {
    if (editForm.novoArquivo) {
      setEditForm((prev) => ({ ...prev, novoArquivo: null }));
      return;
    }
    if (editForm.atestadoPath) {
      await supabase.storage.from(ATESTADOS_BUCKET).remove([editForm.atestadoPath]);
      setEditForm((prev) => ({ ...prev, atestadoPath: undefined, atestadoNome: undefined }));
    }
  };

  const handleFaltaDataChange = (valor: string) => {
    const display = aplicarMascaraData(valor);
    if (display.length === 10 && validarData(display)) {
      setFaltaForm((prev) => ({ ...prev, dataDisplay: display, data: converterParaISO(display) }));
    } else {
      setFaltaForm((prev) => ({ ...prev, dataDisplay: display, data: "" }));
    }
  };

  // Nº de dias efetivo: só é multiplicável para falta integral (atestado).
  // Atraso/saída antecipada são sempre uma única ocorrência.
  const numeroDiasFalta =
    faltaForm.categoria === "integral" ? Math.max(1, parseInt(faltaForm.numeroDias, 10) || 1) : 1;

  // Data de término = início + (nº de dias − 1), inclusiva. Só exibida (readonly).
  const dataTerminoFaltaISO = (() => {
    if (!faltaForm.data) return "";
    const d = new Date(`${faltaForm.data}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + numeroDiasFalta - 1);
    return d.toISOString().slice(0, 10);
  })();

  const handleAdicionarFalta = () => {
    if (funcionarioExistente && faltaForm.data) {
      const duracaoMinutos =
        faltaForm.categoria === "integral"
          ? undefined
          : parseInt(faltaForm.duracao, 10) || undefined;
      if (onAdicionarFaltasPeriodo) {
        onAdicionarFaltasPeriodo(
          funcionarioExistente.id,
          faltaForm.data,
          numeroDiasFalta,
          faltaForm.tipo,
          faltaForm.categoria,
          duracaoMinutos,
        );
      } else if (onAdicionarFalta) {
        onAdicionarFalta(
          funcionarioExistente.id,
          faltaForm.data,
          faltaForm.tipo,
          faltaForm.categoria,
          duracaoMinutos,
        );
      }
      setFaltaForm({
        dataDisplay: "",
        data: "",
        numeroDias: "1",
        tipo: "sem_atestado",
        categoria: "integral",
        duracao: "",
      });
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
      (form.recebeVt && !valorVtValido(form.valorDiarioVt))
    ) {
      return;
    }
    onSalvar({
      nomeCompleto: form.nomeCompleto,
      cpf: form.cpf,
      email: form.email.trim() || undefined,
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
      valorDiarioVt: form.recebeVt ? parseValorVt(form.valorDiarioVt) : 0,
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
    (!form.recebeVt || valorVtValido(form.valorDiarioVt));

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

          {/* Email — destino do envio automático de contracheque */}
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="nome@email.com"
              className={inputClass}
            />
            <p className="text-xs text-gray-500 mt-1">
              Usado no envio automático de contracheques.
            </p>
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
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                    R$
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.valorDiarioVt}
                    onChange={(e) => setForm({ ...form, valorDiarioVt: e.target.value })}
                    onBlur={() => {
                      if (valorVtValido(form.valorDiarioVt))
                        setForm({
                          ...form,
                          valorDiarioVt: formatValorVt(parseValorVt(form.valorDiarioVt)),
                        });
                    }}
                    placeholder="0,00"
                    className={`${inputClass} pl-9`}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Valor por dia usado no Fechamento de Vale-Transporte.
                </p>
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
                      <label className="block text-xs text-gray-600 mb-1">Data de Início</label>
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
                            numeroDias: e.target.value === "integral" ? prev.numeroDias : "1",
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
                  {faltaForm.categoria === "integral" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Número de Dias</label>
                        <input
                          type="number"
                          min={1}
                          value={faltaForm.numeroDias}
                          onChange={(e) =>
                            setFaltaForm((prev) => ({ ...prev, numeroDias: e.target.value }))
                          }
                          placeholder="Ex: 3"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Data de Término</label>
                        <input
                          type="text"
                          value={converterParaBR(dataTerminoFaltaISO)}
                          readOnly
                          placeholder="—"
                          className="w-full px-2 py-1.5 border border-gray-200 bg-gray-100 text-gray-600 rounded text-sm cursor-not-allowed"
                        />
                      </div>
                    </div>
                  )}
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
                          {falta.atestadoPath && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700"
                              title={falta.atestadoNome ?? "Atestado anexado"}
                            >
                              📎 Atestado
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {isAdmin && onEditarFalta && (
                            <button
                              type="button"
                              onClick={() => abrirEdicaoFalta(falta)}
                              className="text-gray-400 hover:text-indigo-600 transition-colors"
                              title="Editar falta"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                          )}
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
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Documentos (somente no modo edição) */}
          {isEdicao && funcionarioExistente && (
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <span>📄</span> Documentos
                </h3>
                {isAdmin && (
                  <label
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      docEnviando
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 cursor-pointer"
                    }`}
                  >
                    {docEnviando ? "Enviando…" : "+ Enviar PDF"}
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={handleUploadDocumento}
                      disabled={docEnviando}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {docsCarregando ? (
                <p className="text-xs text-gray-400 italic">Carregando documentos…</p>
              ) : documentos.length === 0 ? (
                <p className="text-xs text-gray-400 italic">Nenhum documento enviado.</p>
              ) : (
                <div className="space-y-2">
                  {documentos.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => abrirDocumento(doc)}
                        className="text-sm text-indigo-700 underline hover:text-indigo-900 text-left truncate min-w-0"
                        title={doc.file_name}
                      >
                        📎 {doc.file_name}
                      </button>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-gray-400">
                          {converterParaBR(doc.created_at.slice(0, 10))}
                        </span>
                        <button
                          type="button"
                          onClick={() => abrirDocumento(doc)}
                          className="text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 font-medium"
                        >
                          Ver / Baixar
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => removerDocumento(doc)}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            Excluir
                          </button>
                        )}
                      </div>
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

      {/* Modal de edição de uma falta existente */}
      {faltaEditId && funcionarioExistente && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <span>✏️</span> Editar Falta
              </h3>
              <button
                type="button"
                onClick={() => setFaltaEditId(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Data</label>
                  <input
                    type="text"
                    value={editForm.dataDisplay}
                    onChange={(e) => handleEditFaltaDataChange(e.target.value)}
                    placeholder="DD/MM/AAAA"
                    maxLength={10}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Ocorrência</label>
                  <select
                    value={editForm.categoria}
                    onChange={(e) =>
                      setEditForm((prev) => ({
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
                  <label className="block text-xs text-gray-600 mb-1">Tipo / Motivo</label>
                  <select
                    value={editForm.tipo}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, tipo: e.target.value as TipoFalta }))
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
                {editForm.categoria !== "integral" && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      Tempo de Ausência (min)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.duracao}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, duracao: e.target.value }))
                      }
                      placeholder="Ex: 30"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Observação</label>
                <textarea
                  value={editForm.observacao}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, observacao: e.target.value }))}
                  rows={2}
                  placeholder="Ex: atestado médico entregue em 12/05."
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm resize-none"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Atestado (foto ou PDF)</label>
                {editForm.novoArquivo ? (
                  <div className="flex items-center justify-between bg-indigo-50 rounded px-2 py-1.5 text-sm text-indigo-700">
                    <span className="truncate">📎 {editForm.novoArquivo.name}</span>
                    <button
                      type="button"
                      onClick={removerAnexoEdicao}
                      className="text-red-400 hover:text-red-600 text-xs ml-2 shrink-0"
                    >
                      Remover
                    </button>
                  </div>
                ) : editForm.atestadoPath ? (
                  <div className="flex items-center justify-between bg-indigo-50 rounded px-2 py-1.5 text-sm text-indigo-700">
                    <button
                      type="button"
                      onClick={() => abrirAtestado(editForm.atestadoPath!)}
                      className="truncate underline hover:text-indigo-900 text-left"
                    >
                      📎 {editForm.atestadoNome ?? "Ver atestado"}
                    </button>
                    <button
                      type="button"
                      onClick={removerAnexoEdicao}
                      className="text-red-400 hover:text-red-600 text-xs ml-2 shrink-0"
                    >
                      Remover
                    </button>
                  </div>
                ) : null}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      novoArquivo: e.target.files?.[0] ?? null,
                    }))
                  }
                  className="mt-2 w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-indigo-50 file:text-indigo-700 file:text-xs file:font-medium hover:file:bg-indigo-100"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <button
                type="button"
                onClick={() => setFaltaEditId(null)}
                disabled={salvandoEdicao}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSalvarEdicaoFalta}
                disabled={!editForm.data || salvandoEdicao}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {salvandoEdicao ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FuncionarioModal;
