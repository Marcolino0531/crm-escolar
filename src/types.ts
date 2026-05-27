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
