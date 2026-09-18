-- Lotes de pagamento de RH: hr_transport_batches passa a ser neutro quanto ao
-- tipo ('vt' | 'salario'). Os lotes existentes são todos de Vale-Transporte.
-- Lotes de Salário (e seus itens) só são visíveis/editáveis com 'rh_salario'.

alter table public.hr_transport_batches
  add column if not exists tipo text not null default 'vt'
    check (tipo in ('vt', 'salario'));

create index if not exists hr_transport_batches_tipo_idx
  on public.hr_transport_batches (tipo);

comment on column public.hr_transport_batches.tipo is
  'Tipo do lote de pagamento: vt (Vale-Transporte) ou salario.';

-- ── RLS dos lotes ─────────────────────────────────────────────────────────
drop policy if exists "hr transport batches select" on public.hr_transport_batches;
drop policy if exists "hr transport batches insert" on public.hr_transport_batches;
drop policy if exists "hr transport batches update" on public.hr_transport_batches;
drop policy if exists "hr transport batches delete" on public.hr_transport_batches;

create policy "hr transport batches select" on public.hr_transport_batches
  for select to authenticated
  using (
    case tipo
      when 'salario' then public.can_view_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_view_module(auth.uid(), 'rh'::public.app_module)
    end
  );

create policy "hr transport batches insert" on public.hr_transport_batches
  for insert to authenticated
  with check (
    case tipo
      when 'salario' then public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_edit_module(auth.uid(), 'rh'::public.app_module)
    end
  );

create policy "hr transport batches update" on public.hr_transport_batches
  for update to authenticated
  using (
    case tipo
      when 'salario' then public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_edit_module(auth.uid(), 'rh'::public.app_module)
    end
  )
  with check (
    case tipo
      when 'salario' then public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_edit_module(auth.uid(), 'rh'::public.app_module)
    end
  );

create policy "hr transport batches delete" on public.hr_transport_batches
  for delete to authenticated
  using (
    case tipo
      when 'salario' then public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_edit_module(auth.uid(), 'rh'::public.app_module)
    end
  );

-- ── RLS dos itens (herdam o tipo do lote) ─────────────────────────────────
create or replace function public.hr_batch_tipo(_batch_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tipo from public.hr_transport_batches where id = _batch_id
$$;

drop policy if exists "hr transport items select" on public.hr_transport_batch_items;
drop policy if exists "hr transport items insert" on public.hr_transport_batch_items;
drop policy if exists "hr transport items update" on public.hr_transport_batch_items;
drop policy if exists "hr transport items delete" on public.hr_transport_batch_items;

create policy "hr transport items select" on public.hr_transport_batch_items
  for select to authenticated
  using (
    case public.hr_batch_tipo(batch_id)
      when 'salario' then public.can_view_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_view_module(auth.uid(), 'rh'::public.app_module)
    end
  );

create policy "hr transport items insert" on public.hr_transport_batch_items
  for insert to authenticated
  with check (
    case public.hr_batch_tipo(batch_id)
      when 'salario' then public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_edit_module(auth.uid(), 'rh'::public.app_module)
    end
  );

create policy "hr transport items update" on public.hr_transport_batch_items
  for update to authenticated
  using (
    case public.hr_batch_tipo(batch_id)
      when 'salario' then public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_edit_module(auth.uid(), 'rh'::public.app_module)
    end
  )
  with check (
    case public.hr_batch_tipo(batch_id)
      when 'salario' then public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_edit_module(auth.uid(), 'rh'::public.app_module)
    end
  );

create policy "hr transport items delete" on public.hr_transport_batch_items
  for delete to authenticated
  using (
    case public.hr_batch_tipo(batch_id)
      when 'salario' then public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module)
      else public.can_edit_module(auth.uid(), 'rh'::public.app_module)
    end
  );
