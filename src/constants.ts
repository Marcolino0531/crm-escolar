import { ColunaConfig, ColunaOnboardingConfig } from './types';

export const COLUNAS: ColunaConfig[] = [
  {
    id: 'contato-inicial',
    titulo: 'Contato Inicial',
    cor: 'text-blue-700',
    corBorda: 'border-blue-400',
    corFundo: 'bg-blue-50',
    icone: '📞',
  },
  {
    id: 'visita-marcada',
    titulo: 'Visita Marcada',
    cor: 'text-amber-700',
    corBorda: 'border-amber-400',
    corFundo: 'bg-amber-50',
    icone: '📅',
  },
  {
    id: 'negociacao',
    titulo: 'Negociação',
    cor: 'text-purple-700',
    corBorda: 'border-purple-400',
    corFundo: 'bg-purple-50',
    icone: '🤝',
  },
  {
    id: 'matricula',
    titulo: 'Matrícula',
    cor: 'text-green-700',
    corBorda: 'border-green-400',
    corFundo: 'bg-green-50',
    icone: '✅',
  },
  {
    id: 'nao-matricula',
    titulo: 'Não Matrícula',
    cor: 'text-red-700',
    corBorda: 'border-red-400',
    corFundo: 'bg-red-50',
    icone: '❌',
  },
];

export const STORAGE_KEY = 'crm-escolar-leads';
export const ONBOARDING_STORAGE_KEY = 'crm-escolar-onboarding';

export const COLUNAS_ONBOARDING: ColunaOnboardingConfig[] = [
  {
    id: 'ficha-matricula',
    titulo: 'Ficha de Matrícula',
    cor: 'text-blue-700',
    corBorda: 'border-blue-400',
    corFundo: 'bg-blue-50',
    icone: '📋',
  },
  {
    id: 'assinatura-contrato',
    titulo: 'Assinatura de Contrato',
    cor: 'text-amber-700',
    corBorda: 'border-amber-400',
    corFundo: 'bg-amber-50',
    icone: '✍️',
  },
  {
    id: 'cadastro-erp',
    titulo: 'Cadastro no Sistema ERP',
    cor: 'text-purple-700',
    corBorda: 'border-purple-400',
    corFundo: 'bg-purple-50',
    icone: '💻',
  },
  {
    id: 'boas-vindas',
    titulo: 'Boas-vindas & WhatsApp',
    cor: 'text-teal-700',
    corBorda: 'border-teal-400',
    corFundo: 'bg-teal-50',
    icone: '👋',
  },
  {
    id: 'concluido',
    titulo: 'Concluído',
    cor: 'text-green-700',
    corBorda: 'border-green-400',
    corFundo: 'bg-green-50',
    icone: '✅',
  },
];
