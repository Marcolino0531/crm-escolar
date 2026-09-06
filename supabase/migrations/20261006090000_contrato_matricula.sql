-- Contrato de Matrícula/Rematrícula (geração manual pela secretaria + ZapSign
-- em PRODUÇÃO).
--
-- 1) Dados dos Colégios: CPF do representante legal, campo NOVO e separado da
--    OAB — a OAB continua alimentando o Termo de Confissão de Dívida sem
--    alteração; o CPF alimenta apenas o Contrato de Matrícula. Preenchido
--    manualmente por unidade após o deploy.
-- 2) contratos_matricula: um contrato por (unidade, aluno, ano letivo) com o
--    RETRATO dos dados usados na geração (valores, extras lidos do Sponte no
--    momento, responsável financeiro). O documento ZapSign correspondente fica
--    em zapsign_documentos com ambiente = 'producao' e poc = false; o status de
--    assinatura vem do webhook (mesma rota já validada no sandbox).

alter table public.documentos_colegios
  add column if not exists representante_cpf text not null default '';

create table if not exists public.contratos_matricula (
  id uuid primary key default gen_random_uuid(),
  unidade text not null,
  aluno_id text not null,
  ano_letivo integer not null,
  numero_contrato text not null,
  aluno_nome text not null default '',
  responsavel_nome text not null default '',
  responsavel_cpf text not null default '',
  responsavel_email text not null default '',
  status text not null default 'gerando'
    check (status in ('gerando', 'enviado', 'erro')),
  zapsign_documento_id uuid references public.zapsign_documentos (id) on delete set null,
  campos jsonb not null default '{}'::jsonb,
  erro text not null default '',
  enviado_em timestamptz,
  enviado_por uuid references auth.users (id) on delete set null,
  enviado_por_nome text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unidade, aluno_id, ano_letivo)
);

create index if not exists contratos_matricula_unidade_idx
  on public.contratos_matricula (unidade, ano_letivo, created_at desc);

alter table public.contratos_matricula enable row level security;

drop policy if exists "contratos_matricula read" on public.contratos_matricula;
create policy "contratos_matricula read" on public.contratos_matricula
  for select to authenticated
  using (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));

-- Documentos de produção também podem ser lidos por quem vê Rematrícula (a
-- tela de contratos mostra o status de assinatura); escrita só pelo servidor.
drop policy if exists "zapsign_documentos read rematricula" on public.zapsign_documentos;
create policy "zapsign_documentos read rematricula" on public.zapsign_documentos
  for select to authenticated
  using (
    ambiente = 'producao'
    and public.can_view_module(auth.uid(), 'rematricula'::public.app_module)
  );
