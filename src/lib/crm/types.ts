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
  | "em-contato"
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
  // Lead arquivado: matrícula já avançou para o Onboarding; sai do funil sem
  // apagar o histórico (coluna permanece 'matricula').
  arquivado?: boolean;
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
  // Observação livre (ex.: contexto da justificativa). Opcional.
  observacao?: string;
  // Anexo do atestado/justificativa: caminho no bucket privado rh-atestados.
  // O nome original é guardado só para exibição.
  atestadoPath?: string;
  atestadoNome?: string;
}

// ── Terceirizados ──────────────────────────────────────────────────────────
// Profissionais externos (professores de balé, capoeira, robótica, ...) com
// jornada por TURNOS (Manhã/Tarde) de segunda a sexta, em vez de relógio.
export type DiaSemana = "seg" | "ter" | "qua" | "qui" | "sex";
export type Turno = "manha" | "tarde";
// Turno da falta: um turno isolado ou o dia completo (ambos os turnos).
export type TurnoFalta = "manha" | "tarde" | "dia";

export type GradeTurnos = Record<DiaSemana, Record<Turno, boolean>>;

export interface FaltaTerceirizado {
  id: string;
  data: string; // ISO (YYYY-MM-DD)
  turno: TurnoFalta;
  observacao?: string;
}

export interface Terceirizado {
  id: string;
  schoolId: string;
  unidade: string; // school name (display); resolved from schoolId
  nomeCompleto: string;
  especialidade: string; // atividade (Balé, Capoeira, Robótica, ...)
  telefone?: string;
  valorTurno: number; // valor por turno, base para desconto por falta
  grade: GradeTurnos;
  faltas: FaltaTerceirizado[];
  ativo: boolean;
  criadoEm: string;
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
  recebeVt: boolean; // Elegibilidade ao Vale-Transporte
  valorDiarioVt: number; // Valor diário do Vale-Transporte
  ferias: PeriodoFerias[];
  faltas: Falta[];
  criadoEm: string;
}
