-- Auditoria da exclusão de submissões do formulário de matrícula (somente
-- admin). A linha é gravada ANTES de apagar a submissão e os registros ligados
-- (student_routine, matricula_saude, matricula_documentos + arquivos do bucket
-- matricula-documentos, onboarding, matricula_faturamento_lancamentos), para
-- que sobre um rastro mesmo que a exclusão falhe no meio.
--
-- `status_integracao` guarda o que JÁ tinha sido criado no Sponte no momento
-- da exclusão (aluno, matrícula na turma, cobranças lançadas por tipo): a
-- exclusão remove só o registro do School Hub; o que existe no Sponte deve
-- ser cancelado manualmente.
--
-- Acesso só pelo servidor (service_role), sem leitura pelo navegador — mesmo
-- padrão de contratos_boleto_avisos e das tabelas da Cobrança.

create table if not exists public.matricula_exclusoes (
  id uuid primary key default gen_random_uuid(),
  submission_id text not null,
  aluno_nome text not null default '',
  cpf text not null default '',
  unidade text not null default '',
  status_integracao jsonb not null default '{}'::jsonb,
  enviado_em timestamptz,
  excluido_por uuid references auth.users (id) on delete set null,
  excluido_por_nome text not null default '',
  excluido_em timestamptz not null default now()
);

create index if not exists matricula_exclusoes_submission_idx
  on public.matricula_exclusoes (submission_id);

alter table public.matricula_exclusoes enable row level security;

revoke all on public.matricula_exclusoes from anon, authenticated;
grant all on public.matricula_exclusoes to service_role;
