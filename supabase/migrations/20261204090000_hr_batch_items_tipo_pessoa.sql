-- Folha de Salário em três blocos: cada item do lote leva o tipo da pessoa
-- (efetivo, terceirizado ou extra) e, para terceirizado e extra, o id dela
-- (terceirizados.id ou rh_extras.id; sem FK, como rh_pagamentos_valores).
-- Linhas existentes (Salário e Vale-Transporte) ficam "efetivo", sem alteração
-- de valores. RLS, policies e privilégios de hr_transport_batches e
-- hr_transport_batch_items não mudam.

BEGIN;

ALTER TABLE public.hr_transport_batch_items
  ADD COLUMN IF NOT EXISTS tipo_pessoa text NOT NULL DEFAULT 'efetivo',
  ADD COLUMN IF NOT EXISTS pessoa_id uuid;

ALTER TABLE public.hr_transport_batch_items
  DROP CONSTRAINT IF EXISTS hr_transport_batch_items_tipo_pessoa_check;
ALTER TABLE public.hr_transport_batch_items
  ADD CONSTRAINT hr_transport_batch_items_tipo_pessoa_check
    CHECK (tipo_pessoa IN ('efetivo', 'terceirizado', 'extra'));

-- Efetivo não tem pessoa_id; terceirizado e extra têm pessoa_id e não têm employee_id.
ALTER TABLE public.hr_transport_batch_items
  DROP CONSTRAINT IF EXISTS hr_transport_batch_items_pessoa_check;
ALTER TABLE public.hr_transport_batch_items
  ADD CONSTRAINT hr_transport_batch_items_pessoa_check
    CHECK (
      (tipo_pessoa = 'efetivo' AND pessoa_id IS NULL)
      OR (tipo_pessoa <> 'efetivo' AND pessoa_id IS NOT NULL AND employee_id IS NULL)
    );

COMMENT ON COLUMN public.hr_transport_batch_items.tipo_pessoa IS
  'Tipo da pessoa do item: efetivo (employee_id), terceirizado ou extra (pessoa_id).';
COMMENT ON COLUMN public.hr_transport_batch_items.pessoa_id IS
  'Id do terceirizado (terceirizados) ou do Extra (rh_extras); nulo para efetivos.';

COMMIT;
