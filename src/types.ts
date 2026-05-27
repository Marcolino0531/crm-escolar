export interface Lead {
  id: string;
  nomeAluno: string;
  idade: string;
  dataNascimento: string;
  nomePaiMae: string;
  telefone: string;
  coluna: ColunaKanban;
  criadoEm: string;
}

export type ColunaKanban =
  | 'contato-inicial'
  | 'visita-marcada'
  | 'negociacao'
  | 'matricula';

export interface ColunaConfig {
  id: ColunaKanban;
  titulo: string;
  cor: string;
  corBorda: string;
  corFundo: string;
  icone: string;
}
