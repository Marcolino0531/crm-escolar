-- Folhas de Pagamento de Vale-Transporte (RH): "retrato" congelado de um
-- fechamento numa data específica, com controle de pagamento por funcionário.
-- Leitura por can_view_module('rh'); escrita por can_edit_module('rh').

-- ── Lotes ─────────────────────────────────────────────────────────────────
create table if not exists public.hr_transport_batches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete set null,
  title text not null,
  payment_date date,
  reference_month text,
  total_amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists hr_transport_batches_school_idx
  on public.hr_transport_batches (school_id);

-- ── Itens do lote ─────────────────────────────────────────────────────────
create table if not exists public.hr_transport_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.hr_transport_batches (id) on delete cascade,
  employee_id uuid references public.funcionarios (id) on delete set null,
  employee_name text not null default '',
  daily_value numeric not null default 0,
  working_days integer not null default 0,
  absences integer not null default 0,
  total_amount numeric not null default 0,
  is_paid boolean not null default false
);

create index if not exists hr_transport_batch_items_batch_idx
  on public.hr_transport_batch_items (batch_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.hr_transport_batches enable row level security;
alter table public.hr_transport_batch_items enable row level security;

drop policy if exists "hr transport batches select" on public.hr_transport_batches;
drop policy if exists "hr transport batches insert" on public.hr_transport_batches;
drop policy if exists "hr transport batches update" on public.hr_transport_batches;
drop policy if exists "hr transport batches delete" on public.hr_transport_batches;

create policy "hr transport batches select" on public.hr_transport_batches
  for select to authenticated
  using (public.can_view_module(auth.uid(), 'rh'::public.app_module));

create policy "hr transport batches insert" on public.hr_transport_batches
  for insert to authenticated
  with check (public.can_edit_module(auth.uid(), 'rh'::public.app_module));

create policy "hr transport batches update" on public.hr_transport_batches
  for update to authenticated
  using (public.can_edit_module(auth.uid(), 'rh'::public.app_module))
  with check (public.can_edit_module(auth.uid(), 'rh'::public.app_module));

create policy "hr transport batches delete" on public.hr_transport_batches
  for delete to authenticated
  using (public.can_edit_module(auth.uid(), 'rh'::public.app_module));

drop policy if exists "hr transport items select" on public.hr_transport_batch_items;
drop policy if exists "hr transport items insert" on public.hr_transport_batch_items;
drop policy if exists "hr transport items update" on public.hr_transport_batch_items;
drop policy if exists "hr transport items delete" on public.hr_transport_batch_items;

create policy "hr transport items select" on public.hr_transport_batch_items
  for select to authenticated
  using (public.can_view_module(auth.uid(), 'rh'::public.app_module));

create policy "hr transport items insert" on public.hr_transport_batch_items
  for insert to authenticated
  with check (public.can_edit_module(auth.uid(), 'rh'::public.app_module));

create policy "hr transport items update" on public.hr_transport_batch_items
  for update to authenticated
  using (public.can_edit_module(auth.uid(), 'rh'::public.app_module))
  with check (public.can_edit_module(auth.uid(), 'rh'::public.app_module));

create policy "hr transport items delete" on public.hr_transport_batch_items
  for delete to authenticated
  using (public.can_edit_module(auth.uid(), 'rh'::public.app_module));
