-- Controle de Faltas: armazena as faltas de cada funcionário como um array JSONB
-- Cada item: { id: uuid, data: 'YYYY-MM-DD', tipo: 'com_atestado' | 'sem_atestado' }
-- Espelha o padrão já usado pela coluna `ferias` (mesma tabela, mesma RLS).

alter table public.funcionarios
  add column if not exists faltas jsonb NOT NULL DEFAULT '[]'::jsonb;
