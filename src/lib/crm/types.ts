// Domain types for the ported Schooler Hub CRM modules (Admissões, Onboarding, RH).
// App uses camelCase; Supabase rows are snake_case (see mappers in ./mappers.ts).

export interface ItemMatricula {
  id: string;
  tipo: string;
  valor?: number;
  materialPedagogico?: boolean;
  observacoes?: string;
}

export type ColunaKanban =
  | "contato-inicial"
  | "visita-marcada"
  | "negociacao"
  | "matricula"
  | "nao-matricula";

export interface ColunaConfig {
  id: ColunaKanban;
  titulo: string;
  cor: string;
  corBorda: string;
  corFundo: string;
  icone: string;
}

// Legacy unit name (CEC, CEC Baby, ...). In the Supabase stack we key by
// school_id (uuid); this alias keeps ported components compiling where they
// still pass a human-readable unit/school name around.
export type Unidade = string;

// Um aluno (criança) dentro de uma negociação familiar. Um lead pode ter
// vários (irmãos). Os campos escalares do Lead refletem o 1º aluno.
export interface AlunoLead {
  nome: string;
  dataNascimento: string;
  idade: string;
  turma: string;
}

export interface Lead {
  id: string;
  schoolId: string;
  nomeAluno: string;
  idade: string;
  dataNascimento: string;
  turma: string;
  alunos: AlunoLead[];
  nomePaiMae: string;
  telefone: string;
  origem: string;
  coluna: ColunaKanban;
  criadoEm: string;
  dataVisita?: string;
  horarioVisita?: string;
  motivoPerda?: string;
  observacaoPerda?: string;
  itensMatricula?: ItemMatricula[];
}

export interface TarefaOnboardingConfig {
  id: TarefaOnboardingId;
  titulo: string;
  icone: string;
}

export type TarefaOnboardingId =
  | "envio-ficha-matricula"
  | "ficha-matricula-respondida"
  | "cadastro-erp"
  | "envio-contrato"
  | "assinatura-contrato"
  | "boas-vindas"
  | "grupo-whatsapp"
  | "bernoulli-login";

export interface OnboardingAluno {
  id: string;
  schoolId: string;
  leadId: string | null;
  nomeAluno: string;
  turma: string;
  nomePaiMae: string;
  telefone: string;
  tarefas: Record<TarefaOnboardingId, boolean>;
  concluido: boolean;
  criadoEm: string;
}

export interface PeriodoFerias {
  id: string;
  dataInicio: string;
  dataFim: string;
}

export type TipoFalta = "com_atestado" | "sem_atestado";

// Tipo da ocorrência: falta integral (dia inteiro) ou ausência parcial.
export type CategoriaFalta = "integral" | "atraso" | "saida_antecipada";

export interface Falta {
  id: string;
  data: string;
  tipo: TipoFalta;
  // Categoria da ocorrência. Registros antigos não têm este campo e são
  // tratados como "integral".
  categoria?: CategoriaFalta;
  // Tempo de ausência em minutos (apenas para atraso/saída antecipada).
  duracaoMinutos?: number;
}

export type Genero = "feminino" | "masculino" | "outro" | "prefiro-nao-informar";
export type EstadoCivil = "solteiro" | "casado" | "divorciado" | "viuvo" | "outro";

export interface Funcionario {
  id: string;
  schoolId: string;
  unidade: string; // school name (display); resolved from schoolId
  nomeCompleto: string;
  cpf?: string;
  dataNascimento?: string;
  genero?: Genero;
  estadoCivil?: EstadoCivil;
  cargo?: string;
  dataAdmissao?: string;
  dataInicio?: string;
  dataRescisao?: string;
  horarioTrabalhoInicio: string;
  horarioTrabalhoFim: string;
  horarioAlmocoInicio?: string;
  horarioAlmocoFim?: string;
  valorDiarioVt: number; // Valor diário do Vale-Transporte
  ferias: PeriodoFerias[];
  faltas: Falta[];
  criadoEm: string;
}
