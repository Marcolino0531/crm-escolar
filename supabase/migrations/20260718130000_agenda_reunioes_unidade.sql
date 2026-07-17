-- Agenda: unidade (escola) das reuniões manuais.
--
-- Cada reunião passa a pertencer a uma unidade (public.schools). O histórico
-- existente é marcado como "CEC" para não se perder. A coluna é anulável para
-- não quebrar o frontend antigo ainda em produção durante o deploy; o novo
-- modal de "Nova Reunião" exige a seleção da unidade.

ALTER TABLE public.agenda_reunioes
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.schools(id) ON DELETE SET NULL;

-- Backfill: todas as reuniões manuais já existentes viram "CEC".
UPDATE public.agenda_reunioes
   SET unit_id = (SELECT id FROM public.schools WHERE name = 'CEC' LIMIT 1)
 WHERE unit_id IS NULL;

CREATE INDEX IF NOT EXISTS agenda_reunioes_unit_id_idx
  ON public.agenda_reunioes (unit_id);
