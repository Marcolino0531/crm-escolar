-- Cobrança Automática — registro de TODA execução do cron de cobrança.
--
-- Cada tentativa do dia grava uma linha aqui, inclusive as que não geram envio
-- (dia não útil, kill switch, nenhuma parcela cobrável) e as que falham. É o que
-- torna visível no sistema um disparo perdido — antes disso, uma execução que
-- não enviava nada não deixava rastro nenhum.
--
-- `slot` identifica a tentativa do dia (hora de Brasília do agendamento). O par
-- (data_ref, slot) é único: se a mesma tentativa for reexecutada, ela não duplica
-- o registro nem o envio — a idempotência por telefone/dia continua valendo.

CREATE TABLE IF NOT EXISTS public.whatsapp_cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_ref date NOT NULL,
  slot text NOT NULL,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  status text NOT NULL DEFAULT 'em_andamento',
  responsaveis integer NOT NULL DEFAULT 0,
  enviados integer NOT NULL DEFAULT 0,
  falhas integer NOT NULL DEFAULT 0,
  pulados integer NOT NULL DEFAULT 0,
  motivo text,
  erro text,
  duracao_ms integer,
  CONSTRAINT whatsapp_cron_runs_data_slot_key UNIQUE (data_ref, slot)
);

CREATE INDEX IF NOT EXISTS whatsapp_cron_runs_data_ref_idx
  ON public.whatsapp_cron_runs (data_ref DESC);

ALTER TABLE public.whatsapp_cron_runs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_cron_runs'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_cron_runs', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "cobranca view whatsapp_cron_runs" ON public.whatsapp_cron_runs
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'cobranca'::public.app_module));

NOTIFY pgrst, 'reload schema';
