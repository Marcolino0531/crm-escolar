-- Cancelamento de contrato pelo School Hub (POST /refuse/ na ZapSign).
-- O contrato passa a admitir o status 'cancelado', com motivo e autor gravados;
-- um contrato cancelado libera a geração de um novo para o mesmo aluno/ano.

alter table public.contratos_matricula
  drop constraint if exists contratos_matricula_status_check;

alter table public.contratos_matricula
  add constraint contratos_matricula_status_check
  check (status in ('gerando', 'enviado', 'erro', 'cancelado'));

alter table public.contratos_matricula
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por uuid references auth.users (id) on delete set null,
  add column if not exists cancelado_por_nome text not null default '',
  add column if not exists cancelamento_motivo text not null default '';

alter table public.zapsign_documentos
  add column if not exists recusado_em timestamptz,
  add column if not exists recusa_motivo text not null default '',
  add column if not exists recusado_por_nome text not null default '';
