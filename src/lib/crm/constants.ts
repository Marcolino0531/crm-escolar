import type { ColunaConfig, TarefaOnboardingConfig, TarefaOnboardingId } from "./types";

export const COLUNAS: ColunaConfig[] = [
  {
    id: "contato-inicial",
    titulo: "Contato Inicial",
    cor: "text-blue-700",
    corBorda: "border-blue-400",
    corFundo: "bg-blue-50",
    icone: "📞",
  },
  {
    id: "em-contato",
    titulo: "Em contato",
    cor: "text-cyan-700",
    corBorda: "border-cyan-400",
    corFundo: "bg-cyan-50",
    icone: "💬",
  },
  {
    id: "visita-marcada",
    titulo: "Visita Marcada",
    cor: "text-amber-700",
    corBorda: "border-amber-400",
    corFundo: "bg-amber-50",
    icone: "📅",
  },
  {
    id: "negociacao",
    titulo: "Negociação",
    cor: "text-purple-700",
    corBorda: "border-purple-400",
    corFundo: "bg-purple-50",
    icone: "🤝",
  },
  {
    id: "matricula",
    titulo: "Matrícula",
    cor: "text-green-700",
    corBorda: "border-green-400",
    corFundo: "bg-green-50",
    icone: "✅",
  },
  {
    id: "nao-matricula",
    titulo: "Não Matrícula",
    cor: "text-red-700",
    corBorda: "border-red-400",
    corFundo: "bg-red-50",
    icone: "❌",
  },
];

// O registro só nasce depois de a matrícula estar formalizada (aluno criado no
// Sponte e matriculado na turma), então o checklist trata apenas do que vem
// DEPOIS disso.
export const TAREFAS_ONBOARDING: TarefaOnboardingConfig[] = [
  { id: "genero-sponte", titulo: "Atualização do gênero no Sponte", icone: "🧾" },
  { id: "conferencia-turma", titulo: "Conferência da turma matriculada", icone: "🏫" },
  { id: "boas-vindas", titulo: "Boas-vindas e informações básicas", icone: "👋" },
  { id: "grupo-whatsapp", titulo: "Inclusão no grupo de WhatsApp da turma", icone: "💬" },
  { id: "assinatura-contrato", titulo: "Assinatura do contrato", icone: "✍️" },
  { id: "entrega-materiais", titulo: "Entrega dos materiais pedagógicos", icone: "📚" },
];

export const TAREFAS_INICIAIS: Record<TarefaOnboardingId, boolean> = {
  "genero-sponte": false,
  "conferencia-turma": false,
  "boas-vindas": false,
  "grupo-whatsapp": false,
  "assinatura-contrato": false,
  "entrega-materiais": false,
};

// Known Schooler Hub units (must match the names seeded in the `schools` table).
export const UNIDADES: string[] = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

export const ORIGENS_PREDEFINIDAS = ["Instagram", "Site", "Indicação", "Passou na porta"];
export const ORIGENS_STORAGE_KEY = "crm-escolar-origens-custom";
