-- Cancelamento com data em vez de exclusão física: a linha continua no banco
-- para que a arrecadação de meses anteriores ao cancelamento não perca alunos.
alter table public.esportes_matriculas
  add column if not exists cancelado_em date;

create index if not exists esportes_matriculas_ativas_idx
  on public.esportes_matriculas (modalidade_id)
  where cancelado_em is null;
