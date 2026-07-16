-- Gestão de documentos do funcionário (RH): contratos, TRCTs, atestados, etc.
-- Bucket privado (acesso via URL assinada gerada pelo cliente autorizado) +
-- tabela de vínculo funcionário → arquivo.
-- Leitura exige can_view_module('rh'); escrita exige can_edit_module('rh').

-- ── Bucket ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('hr-documents', 'hr-documents', false)
on conflict (id) do nothing;

drop policy if exists "hr documents read" on storage.objects;
drop policy if exists "hr documents insert" on storage.objects;
drop policy if exists "hr documents update" on storage.objects;
drop policy if exists "hr documents delete" on storage.objects;

create policy "hr documents read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'hr-documents'
    and public.can_view_module(auth.uid(), 'rh'::public.app_module)
  );

create policy "hr documents insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'hr-documents'
    and public.can_edit_module(auth.uid(), 'rh'::public.app_module)
  );

create policy "hr documents update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'hr-documents'
    and public.can_edit_module(auth.uid(), 'rh'::public.app_module)
  )
  with check (
    bucket_id = 'hr-documents'
    and public.can_edit_module(auth.uid(), 'rh'::public.app_module)
  );

create policy "hr documents delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'hr-documents'
    and public.can_edit_module(auth.uid(), 'rh'::public.app_module)
  );

-- ── Tabela ────────────────────────────────────────────────────────────────
create table if not exists public.hr_employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.funcionarios (id) on delete cascade,
  file_name text not null,
  file_url text not null,
  storage_path text,
  created_at timestamptz not null default now()
);

create index if not exists hr_employee_documents_employee_idx
  on public.hr_employee_documents (employee_id);

alter table public.hr_employee_documents enable row level security;

drop policy if exists "hr docs select" on public.hr_employee_documents;
drop policy if exists "hr docs insert" on public.hr_employee_documents;
drop policy if exists "hr docs delete" on public.hr_employee_documents;

create policy "hr docs select" on public.hr_employee_documents
  for select to authenticated
  using (public.can_view_module(auth.uid(), 'rh'::public.app_module));

create policy "hr docs insert" on public.hr_employee_documents
  for insert to authenticated
  with check (public.can_edit_module(auth.uid(), 'rh'::public.app_module));

create policy "hr docs delete" on public.hr_employee_documents
  for delete to authenticated
  using (public.can_edit_module(auth.uid(), 'rh'::public.app_module));
