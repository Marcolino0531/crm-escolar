export interface ItemMatricula {
  id: string;
  tipo: string;
  valor?: number;
  materialPedagogico?: boolean;
  observacoes?: string;
}

export interface Lead {
  id: string;
  nomeAluno: string;
  idade: string;
  dataNascimento: string;
  turma: string;
  nomePaiMae: string;
  telefone: string;
  coluna: ColunaKanban;
  criadoEm: string;
  dataVisita?: string;
  horarioVisita?: string;
  motivoPerda?: string;
  observacaoPerda?: string;
  itensMatricula?: ItemMatricula[];
}

export type ColunaKanban =
  | 'contato-inicial'
  | 'visita-marcada'
  | 'negociacao'
  | 'matricula'
  | 'nao-matricula';

export interface ColunaConfig {
  id: ColunaKanban;
  titulo: string;
  cor: string;
  corBorda: string;
  corFundo: string;
  icone: string;
}

export type ColunaOnboarding =
  | 'ficha-matricula'
  | 'assinatura-contrato'
  | 'cadastro-erp'
  | 'boas-vindas'
  | 'concluido';

export interface ColunaOnboardingConfig {
  id: ColunaOnboarding;
  titulo: string;
  cor: string;
  corBorda: string;
  corFundo: string;
  icone: string;
}

export interface OnboardingAluno {
  id: string;
  leadId: string;
  nomeAluno: string;
  turma: string;
  nomePaiMae: string;
  telefone: string;
  coluna: ColunaOnboarding;
  criadoEm: string;
}
