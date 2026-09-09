-- Diário — isenção de consumo extra: o diretor decide não cobrar um consumo
-- específico (bonificação/acordo com o responsável). Um evento isento nunca
-- entra em faturamento; só pode ser isentado enquanto não está faturado.

ALTER TABLE public.diario_events
  ADD COLUMN IF NOT EXISTS isento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS isento_em timestamptz,
  ADD COLUMN IF NOT EXISTS isento_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS isento_por_nome text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS isento_motivo text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.diario_events.isento IS
  'Consumo extra que não será cobrado (decisão do diretor). Nunca entra em diario_faturamentos.';

-- O índice de pendências passa a ignorar os isentos.
DROP INDEX IF EXISTS public.diario_events_pendentes_idx;
CREATE INDEX IF NOT EXISTS diario_events_pendentes_idx
  ON public.diario_events (student_id)
  WHERE extra_charge AND faturamento_id IS NULL AND NOT isento;
