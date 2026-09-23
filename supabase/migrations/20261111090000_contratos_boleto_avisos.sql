-- Aviso "Enviar boleto de matrícula" no sino: gerado uma única vez quando o
-- contrato de matrícula fica totalmente assinado na ZapSign (transição para
-- "signed" em aplicarEstadoDocumento) e removido se o contrato for cancelado.
-- Só some quando o destinatário dá o check ("Boleto enviado").
--
-- Destinatários ficam em tabela própria (hoje só o Sérgio), para incluir outra
-- pessoa sem alterar código. Ambas as tabelas são lidas/escritas só pelo
-- servidor (service_role), sem acesso direto do navegador — mesmo padrão de
-- inadimplencia_fechamento_mensal e das tabelas da Cobrança.

create table if not exists public.contratos_boleto_destinatarios (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

insert into public.contratos_boleto_destinatarios (user_id, email)
select id, email from auth.users where email = 'sergiogmribeiro@gmail.com'
on conflict (user_id) do nothing;

create table if not exists public.contratos_boleto_avisos (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null unique references public.contratos_matricula (id) on delete cascade,
  assinado_em timestamptz not null,
  created_at timestamptz not null default now(),
  concluido_em timestamptz,
  concluido_por uuid references auth.users (id) on delete set null,
  concluido_por_nome text not null default ''
);

create index if not exists contratos_boleto_avisos_pendentes_idx
  on public.contratos_boleto_avisos (created_at desc)
  where concluido_em is null;

alter table public.contratos_boleto_destinatarios enable row level security;
alter table public.contratos_boleto_avisos enable row level security;

revoke all on public.contratos_boleto_destinatarios from anon, authenticated;
revoke all on public.contratos_boleto_avisos from anon, authenticated;
grant all on public.contratos_boleto_destinatarios to service_role;
grant all on public.contratos_boleto_avisos to service_role;
