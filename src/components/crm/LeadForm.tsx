import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Lead, AlunoLead } from "@/lib/crm/types";
import { calcularIdadeEscolar } from "@/lib/crm/mecCutoff";
import { ORIGENS_PREDEFINIDAS, ORIGENS_STORAGE_KEY } from "@/lib/crm/constants";

export interface LeadFormValues {
  schoolId: string;
  alunos: AlunoLead[];
  nomePaiMae: string;
  telefone: string;
  origem: string;
}

interface LeadFormProps {
  onSubmit: (dados: LeadFormValues) => void;
  onFechar: () => void;
  unidadeSelecionada: string;
  // Unidades que o usuário tem permissão de acessar (popula o seletor do modal).
  escolas: { id: string; name: string }[];
  // Unidade pré-selecionada (= filtro global, quando aplicável).
  schoolIdInicial: string;
  leadParaEditar?: Lead | null;
  onEditar?: (leadId: string, dados: Partial<LeadFormValues>) => void;
}

// Estado de um bloco de aluno no formulário (inclui a data em formato BR p/ UI).
interface AlunoFormState {
  nome: string;
  dataNascimento: string; // ISO (YYYY-MM-DD)
  dataNascimentoDisplay: string; // BR (DD/MM/AAAA)
  idade: string;
  turma: string;
}

function alunoVazio(): AlunoFormState {
  return { nome: "", dataNascimento: "", dataNascimentoDisplay: "", idade: "", turma: "" };
}

function carregarOrigensCustom(): string[] {
  try {
    const dados = localStorage.getItem(ORIGENS_STORAGE_KEY);
    return dados ? JSON.parse(dados) : [];
  } catch {
    return [];
  }
}

function salvarOrigensCustom(origens: string[]) {
  localStorage.setItem(ORIGENS_STORAGE_KEY, JSON.stringify(origens));
}

function converterISOparaBR(dataISO: string): string {
  if (!dataISO) return "";
  const partes = dataISO.split("-");
  if (partes.length !== 3) return "";
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

const LeadForm: React.FC<LeadFormProps> = ({
  onSubmit,
  onFechar,
  escolas,
  schoolIdInicial,
  leadParaEditar,
  onEditar,
}) => {
  const isEditMode = !!leadParaEditar;

  // Default = unidade do filtro global; se inválida/ausente, 1ª unidade permitida.
  const schoolIdPadrao =
    schoolIdInicial && escolas.some((e) => e.id === schoolIdInicial)
      ? schoolIdInicial
      : (escolas[0]?.id ?? "");
  const [schoolId, setSchoolId] = useState(schoolIdPadrao);

  const [alunos, setAlunos] = useState<AlunoFormState[]>([alunoVazio()]);
  const [nomePaiMae, setNomePaiMae] = useState("");
  const [telefone, setTelefone] = useState("");
  const [origem, setOrigem] = useState("");

  const [origensCustom, setOrigensCustom] = useState<string[]>(carregarOrigensCustom);
  const [origemInputValue, setOrigemInputValue] = useState("");
  const [origemDropdownOpen, setOrigemDropdownOpen] = useState(false);
  const origemRef = useRef<HTMLDivElement>(null);
  const origemInputRef = useRef<HTMLInputElement>(null);
  const origemDropdownRef = useRef<HTMLDivElement>(null);
  const [origemDropdownPos, setOrigemDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // Posiciona o dropdown (portalizado no body) ancorado ao input. Trava
  // anti-clipping: se não couber abaixo e houver mais espaço acima, abre para
  // CIMA; a altura máxima sempre respeita o espaço visível da viewport.
  const atualizarPosicaoOrigem = useCallback(() => {
    const el = origemInputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const GAP = 4;
    const ALTURA_MAX = 192; // max-h-48
    const espacoAbaixo = window.innerHeight - rect.bottom - 8;
    const espacoAcima = rect.top - 8;
    const abrirAcima = espacoAbaixo < ALTURA_MAX && espacoAcima > espacoAbaixo;
    const maxHeight = Math.max(
      120,
      Math.min(ALTURA_MAX, abrirAcima ? espacoAcima : espacoAbaixo),
    );
    const top = abrirAcima ? rect.top - GAP - maxHeight : rect.bottom + GAP;
    setOrigemDropdownPos({ top, left: rect.left, width: rect.width, maxHeight });
  }, []);

  const todasOrigens = [
    ...ORIGENS_PREDEFINIDAS,
    ...origensCustom.filter((o) => !ORIGENS_PREDEFINIDAS.includes(o)),
  ];

  useEffect(() => {
    if (leadParaEditar) {
      const alunosEdit: AlunoFormState[] = (
        leadParaEditar.alunos.length > 0
          ? leadParaEditar.alunos
          : [
              {
                nome: leadParaEditar.nomeAluno,
                dataNascimento: leadParaEditar.dataNascimento,
                idade: leadParaEditar.idade,
                turma: leadParaEditar.turma,
              },
            ]
      ).map((a) => ({
        nome: a.nome,
        dataNascimento: a.dataNascimento,
        dataNascimentoDisplay: converterISOparaBR(a.dataNascimento),
        idade: a.idade,
        turma: a.turma,
      }));
      setAlunos(alunosEdit);
      setNomePaiMae(leadParaEditar.nomePaiMae);
      setTelefone(leadParaEditar.telefone);
      setOrigem(leadParaEditar.origem || "");
      setOrigemInputValue(leadParaEditar.origem || "");
    }
  }, [leadParaEditar]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const insideAnchor = origemRef.current?.contains(target);
      const insideDropdown = origemDropdownRef.current?.contains(target);
      if (!insideAnchor && !insideDropdown) {
        setOrigemDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keep the portaled dropdown anchored to the input on scroll/resize.
  useEffect(() => {
    if (!origemDropdownOpen) return;
    atualizarPosicaoOrigem();
    window.addEventListener("scroll", atualizarPosicaoOrigem, true);
    window.addEventListener("resize", atualizarPosicaoOrigem);
    return () => {
      window.removeEventListener("scroll", atualizarPosicaoOrigem, true);
      window.removeEventListener("resize", atualizarPosicaoOrigem);
    };
  }, [origemDropdownOpen, atualizarPosicaoOrigem]);

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

  const validarData = (dataBR: string): boolean => {
    if (dataBR.length !== 10) return false;
    const partes = dataBR.split("/");
    if (partes.length !== 3) return false;
    const [dia, mes, ano] = partes.map(Number);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1900) return false;
    const d = new Date(ano, mes - 1, dia);
    return d.getDate() === dia && d.getMonth() === mes - 1 && d.getFullYear() === ano;
  };

  const atualizarAluno = (idx: number, patch: Partial<AlunoFormState>) => {
    setAlunos((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const handleNomeAlunoChange = (idx: number, value: string) => {
    atualizarAluno(idx, { nome: value });
  };

  const handleDataNascimentoChange = (idx: number, rawValue: string) => {
    const display = aplicarMascaraData(rawValue);
    if (display.length === 10 && validarData(display)) {
      const dataNascimento = converterParaISO(display);
      const { idade, turma } = calcularIdadeEscolar(dataNascimento);
      atualizarAluno(idx, {
        dataNascimentoDisplay: display,
        dataNascimento,
        idade: String(idade),
        turma,
      });
    } else {
      atualizarAluno(idx, {
        dataNascimentoDisplay: display,
        dataNascimento: "",
        idade: "",
        turma: "",
      });
    }
  };

  const adicionarIrmao = () => setAlunos((prev) => [...prev, alunoVazio()]);

  const removerAluno = (idx: number) =>
    setAlunos((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleOrigemSelect = (valor: string) => {
    setOrigem(valor);
    setOrigemInputValue(valor);
    setOrigemDropdownOpen(false);
  };

  const handleOrigemInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setOrigemInputValue(value);
    setOrigem(value);
    setOrigemDropdownOpen(true);
  };

  const filteredOrigens = todasOrigens.filter((o) =>
    o.toLowerCase().includes(origemInputValue.toLowerCase()),
  );

  const showCreateOption =
    origemInputValue.trim() !== "" &&
    !todasOrigens.some((o) => o.toLowerCase() === origemInputValue.trim().toLowerCase());

  const alunosValidos = alunos.every((a) => a.nome.trim() && a.dataNascimento);
  const formValido =
    (isEditMode || !!schoolId) &&
    alunosValidos &&
    nomePaiMae.trim() &&
    telefone.trim() &&
    origem.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValido) return;

    // Save custom origin if new
    const origemTrimmed = origem.trim();
    if (!todasOrigens.some((o) => o.toLowerCase() === origemTrimmed.toLowerCase())) {
      const novasCustom = [...origensCustom, origemTrimmed];
      setOrigensCustom(novasCustom);
      salvarOrigensCustom(novasCustom);
    }

    const alunosPayload: AlunoLead[] = alunos.map((a) => ({
      nome: a.nome.trim(),
      dataNascimento: a.dataNascimento,
      idade: a.idade,
      turma: a.turma,
    }));

    if (isEditMode && leadParaEditar && onEditar) {
      onEditar(leadParaEditar.id, {
        alunos: alunosPayload,
        nomePaiMae,
        telefone,
        origem: origemTrimmed,
      });
    } else {
      onSubmit({ schoolId, alunos: alunosPayload, nomePaiMae, telefone, origem: origemTrimmed });
    }

    if (!isEditMode) {
      setSchoolId(schoolIdPadrao);
      setAlunos([alunoVazio()]);
      setNomePaiMae("");
      setTelefone("");
      setOrigem("");
      setOrigemInputValue("");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{isEditMode ? "✏️" : "📝"}</span>
              <h2 className="text-white text-lg font-bold">
                {isEditMode ? "Editar Lead" : "Novo Lead"}
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
          {/* Unidade (somente na criação) — grava o lead na unidade escolhida,
              independentemente do filtro global. Opções = unidades permitidas. */}
          {!isEditMode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unidade <span className="text-red-500">*</span>
              </label>
              <select
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                required
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
              >
                {escolas.length === 0 && <option value="">Nenhuma unidade disponível</option>}
                {escolas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dados do Responsável (contato) — no topo: foco em quem faz o contato.
              Também joga o dropdown de Origem para a parte superior/central da
              tela, evitando o corte (overflow) na borda inferior do modal. */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-4">
            <span className="text-xs font-bold uppercase tracking-wide text-indigo-600">
              Responsável
            </span>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nome do Pai/Mãe <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={nomePaiMae}
                onChange={(e) => setNomePaiMae(e.target.value)}
                required
                placeholder="Ex: Maria da Silva"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Telefone <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                required
                placeholder="Ex: (11) 99999-9999"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
              />
            </div>

            {/* Origem — Creatable Select (Portal + flip anti-clipping) */}
            <div ref={origemRef} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Como conheceu o colégio? (Origem) <span className="text-red-500">*</span>
              </label>
              <input
                ref={origemInputRef}
                type="text"
                value={origemInputValue}
                onChange={handleOrigemInputChange}
                onFocus={() => {
                  atualizarPosicaoOrigem();
                  setOrigemDropdownOpen(true);
                }}
                placeholder="Selecione ou digite uma nova origem..."
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
              />
              {origemDropdownOpen &&
                origemDropdownPos &&
                (filteredOrigens.length > 0 || showCreateOption) &&
                createPortal(
                  <div
                    ref={origemDropdownRef}
                    style={{
                      position: "fixed",
                      top: origemDropdownPos.top,
                      left: origemDropdownPos.left,
                      width: origemDropdownPos.width,
                      maxHeight: origemDropdownPos.maxHeight,
                      zIndex: 9999,
                    }}
                    className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto"
                  >
                    {filteredOrigens.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => handleOrigemSelect(o)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors ${
                          origem === o
                            ? "bg-indigo-50 text-indigo-700 font-medium"
                            : "text-gray-700"
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                    {showCreateOption && (
                      <button
                        type="button"
                        onClick={() => handleOrigemSelect(origemInputValue.trim())}
                        className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors font-medium border-t border-gray-100"
                      >
                        + Criar &quot;{origemInputValue.trim()}&quot;
                      </button>
                    )}
                  </div>,
                  document.body,
                )}
            </div>
          </div>

          {/* Blocos de alunos (irmãos) */}
          {alunos.map((aluno, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-indigo-600">
                  {alunos.length > 1 ? `Aluno ${idx + 1}` : "Aluno"}
                </span>
                {alunos.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removerAluno(idx)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    title="Remover este aluno"
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
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome do Aluno <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={aluno.nome}
                  onChange={(e) => handleNomeAlunoChange(idx, e.target.value)}
                  required
                  placeholder="Ex: João da Silva"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data de Nascimento <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={aluno.dataNascimentoDisplay}
                  onChange={(e) => handleDataNascimentoChange(idx, e.target.value)}
                  placeholder="DD/MM/AAAA"
                  maxLength={10}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Idade e Turma são calculadas pela Data de Corte do MEC (31/03)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Idade (em 31/03)
                  </label>
                  <input
                    type="text"
                    value={aluno.idade ? `${aluno.idade} ${aluno.idade === "1" ? "ano" : "anos"}` : ""}
                    readOnly
                    placeholder="Automático"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 text-sm cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Turma</label>
                  <input
                    type="text"
                    value={aluno.turma}
                    readOnly
                    placeholder="Automático"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 text-sm cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Botão adicionar irmão */}
          <button
            type="button"
            onClick={adicionarIrmao}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 px-4 py-2.5 text-sm font-medium text-indigo-600 hover:bg-indigo-100 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Adicionar Irmão
          </button>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onFechar}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!formValido}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-colors text-sm font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isEditMode ? "Salvar Alterações" : "Cadastrar Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LeadForm;
