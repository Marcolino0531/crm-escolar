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

export const TAREFAS_ONBOARDING: TarefaOnboardingConfig[] = [
  { id: "envio-ficha-matricula", titulo: "Envio da Ficha de Matrícula", icone: "📋" },
  { id: "ficha-matricula-respondida", titulo: "Ficha de Matrícula Respondida", icone: "✅" },
  { id: "cadastro-erp", titulo: "Cadastro no Sistema ERP", icone: "💻" },
  { id: "envio-contrato", titulo: "Envio do Contrato", icone: "📤" },
  { id: "assinatura-contrato", titulo: "Assinatura do Contrato", icone: "✍️" },
  { id: "boas-vindas", titulo: "Boas-vindas e Informações Básicas", icone: "👋" },
  { id: "grupo-whatsapp", titulo: "Inclusão no Grupo de WhatsApp", icone: "💬" },
  {
    id: "bernoulli-login",
    titulo: "Inclusão no Sistema Bernoulli e Envio de Login e Senha para os pais",
    icone: "🔑",
  },
];

export const TAREFAS_INICIAIS: Record<TarefaOnboardingId, boolean> = {
  "envio-ficha-matricula": false,
  "ficha-matricula-respondida": false,
  "cadastro-erp": false,
  "envio-contrato": false,
  "assinatura-contrato": false,
  "boas-vindas": false,
  "grupo-whatsapp": false,
  "bernoulli-login": false,
};

// Known Schooler Hub units (must match the names seeded in the `schools` table).
export const UNIDADES: string[] = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

export const ORIGENS_PREDEFINIDAS = ["Instagram", "Site", "Indicação", "Passou na porta"];
export const ORIGENS_STORAGE_KEY = "crm-escolar-origens-custom";
