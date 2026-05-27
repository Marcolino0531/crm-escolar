export type Unidade = 'CEC' | 'CEC Baby' | 'Núcleo Belvedere' | 'Núcleo Vale do Sereno';

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
  unidade: Unidade;
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

export type TarefaOnboardingId =
  | 'inicio-cadastro'
  | 'cadastro-erp'
  | 'envio-contrato'
  | 'assinatura-contrato'
  | 'boas-vindas'
  | 'grupo-whatsapp'
  | 'bernoulli-login';

export interface TarefaOnboardingConfig {
  id: TarefaOnboardingId;
  titulo: string;
  icone: string;
}

export interface OnboardingAluno {
  id: string;
  leadId: string;
  nomeAluno: string;
  turma: string;
  nomePaiMae: string;
  telefone: string;
  unidade: Unidade;
  tarefas: Record<TarefaOnboardingId, boolean>;
  concluido: boolean;
  criadoEm: string;
}

export interface PeriodoFerias {
  id: string;
  dataInicio: string;
  dataFim: string;
}

export interface Funcionario {
  id: string;
  nomeCompleto: string;
  cargo: string;
  unidade: Unidade;
  dataAdmissao: string;
  dataRescisao?: string;
  horarioTrabalhoInicio: string;
  horarioTrabalhoFim: string;
  horarioAlmocoInicio: string;
  horarioAlmocoFim: string;
  ferias: PeriodoFerias[];
  criadoEm: string;
}
