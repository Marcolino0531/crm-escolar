-- Contrato de Matrícula: assinatura digital do representante legal e das duas
-- testemunhas (além do responsável financeiro).
--
-- 1) Dados dos Colégios: e-mail e celular PESSOAIS do representante legal, por
--    unidade. São os dados de assinatura na ZapSign — nunca o e-mail
--    institucional da unidade. Preenchidos manualmente após o deploy.
-- 2) contrato_testemunhas: cadastro GLOBAL (as mesmas duas pessoas assinam nas
--    três escolas). O flag `ativa` permite trocar uma testemunha sem apagar o
--    histórico. Populada com os dois nomes/CPFs que viviam fixos no código;
--    e-mail/celular ficam para o diretor preencher em Configurações.

alter table public.documentos_colegios
  add column if not exists representante_email text not null default '',
  add column if not exists representante_celular text not null default '';

create table if not exists public.contrato_testemunhas (
  id uuid primary key default gen_random_uuid(),
  ordem integer not null,
  nome text not null default '',
  cpf text not null default '',
  email text not null default '',
  celular text not null default '',
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_nome text not null default ''
);

create unique index if not exists contrato_testemunhas_ordem_ativa_idx
  on public.contrato_testemunhas (ordem) where ativa;

insert into public.contrato_testemunhas (ordem, nome, cpf)
select 1, 'Márcia Regina Ribeiro Marcolino', '631.466.656-20'
where not exists (select 1 from public.contrato_testemunhas where ordem = 1 and ativa);

insert into public.contrato_testemunhas (ordem, nome, cpf)
select 2, 'Anna Clara Marcolino Ribeiro', '157.432.546-99'
where not exists (select 1 from public.contrato_testemunhas where ordem = 2 and ativa);

alter table public.contrato_testemunhas enable row level security;

drop policy if exists "contrato testemunhas select" on public.contrato_testemunhas;
create policy "contrato testemunhas select" on public.contrato_testemunhas
  for select to authenticated
  using (public.can_view_module(auth.uid(), 'documentos'::public.app_module));

drop policy if exists "contrato testemunhas update" on public.contrato_testemunhas;
create policy "contrato testemunhas update" on public.contrato_testemunhas
  for update to authenticated
  using (public.can_edit_module(auth.uid(), 'documentos'::public.app_module))
  with check (public.can_edit_module(auth.uid(), 'documentos'::public.app_module));
