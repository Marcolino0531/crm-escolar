import { ColunaConfig } from './types';

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
