-- Diário — Fase C: Entrada e Saída registradas separadamente, com a duração da
-- hora extra em minutos (já descontadas as tolerâncias de 15 min antes da
-- entrada e 30 min depois da saída contratadas). O booleano extra_charge segue
-- valendo para as refeições; para entrada/saída passa a indicar minutos > 0 ou
-- dia sem horário contratado (extra_minutes NULL = conferir manualmente).

ALTER TABLE public.diario_events
  ADD COLUMN IF NOT EXISTS direction text
    CHECK (direction IN ('entrada', 'saida')),
  ADD COLUMN IF NOT EXISTS extra_minutes integer
    CHECK (extra_minutes IS NULL OR extra_minutes >= 0);

COMMENT ON COLUMN public.diario_events.direction IS
  'Ponta registrada em eventos checkinout: entrada ou saida. NULL nos registros antigos (Entrada / Saída única).';
COMMENT ON COLUMN public.diario_events.extra_minutes IS
  'Minutos de hora extra além da tolerância (15 min antes da entrada / 30 min depois da saída). NULL quando não há horário contratado no dia.';
