-- Bucket privado para anexos de atestado/justificativa de faltas (RH).
-- Leitura exige can_view_module('rh'); escrita exige can_edit_module('rh').
-- Admin sempre passa (has_role dentro das funções). Bucket privado: o acesso
-- ao arquivo se dá por URL assinada gerada pelo cliente autorizado.

insert into storage.buckets (id, name, public)
values ('rh-atestados', 'rh-atestados', false)
on conflict (id) do nothing;

drop policy if exists "rh atestados read" on storage.objects;
drop policy if exists "rh atestados insert" on storage.objects;
drop policy if exists "rh atestados update" on storage.objects;
drop policy if exists "rh atestados delete" on storage.objects;

create policy "rh atestados read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'rh-atestados'
    and public.can_view_module(auth.uid(), 'rh'::public.app_module)
  );

create policy "rh atestados insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'rh-atestados'
    and public.can_edit_module(auth.uid(), 'rh'::public.app_module)
  );

create policy "rh atestados update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'rh-atestados'
    and public.can_edit_module(auth.uid(), 'rh'::public.app_module)
  )
  with check (
    bucket_id = 'rh-atestados'
    and public.can_edit_module(auth.uid(), 'rh'::public.app_module)
  );

create policy "rh atestados delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'rh-atestados'
    and public.can_edit_module(auth.uid(), 'rh'::public.app_module)
  );
