-- Terceirizados (RH): profissionais externos (professores de balé, capoeira,
-- robótica, etc.) com jornada semanal por TURNOS (Manhã/Tarde, seg–sex) em vez
-- de horários exatos de relógio. As faltas são fracionadas por turno.
-- Leitura por can_view_module('rh'); escrita por can_edit_module('rh').

create table if not exists public.terceirizados (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete set null,
  nome_completo text not null,
  especialidade text not null default '',
  telefone text,
  valor_turno numeric not null default 0,
  -- Grade semanal por turno: { seg: {manha, tarde}, ter: {...}, ... }.
  grade jsonb not null default '{}'::jsonb,
  -- Faltas fracionadas: [{ id, data, turno ("manha"|"tarde"|"dia"), observacao }].
  faltas jsonb not null default '[]'::jsonb,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists terceirizados_school_idx
  on public.terceirizados (school_id);

alter table public.terceirizados enable row level security;

drop policy if exists "terceirizados select" on public.terceirizados;
drop policy if exists "terceirizados insert" on public.terceirizados;
drop policy if exists "terceirizados update" on public.terceirizados;
drop policy if exists "terceirizados delete" on public.terceirizados;

create policy "terceirizados select" on public.terceirizados
  for select to authenticated
  using (public.can_view_module(auth.uid(), 'rh'::public.app_module));

create policy "terceirizados insert" on public.terceirizados
  for insert to authenticated
  with check (public.can_edit_module(auth.uid(), 'rh'::public.app_module));

create policy "terceirizados update" on public.terceirizados
  for update to authenticated
  using (public.can_edit_module(auth.uid(), 'rh'::public.app_module))
  with check (public.can_edit_module(auth.uid(), 'rh'::public.app_module));

create policy "terceirizados delete" on public.terceirizados
  for delete to authenticated
  using (public.can_edit_module(auth.uid(), 'rh'::public.app_module));

notify pgrst, 'reload schema';
