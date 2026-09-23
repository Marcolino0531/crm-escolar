-- Cobrança: data de início informada (editável até o 1º print) e data real de
-- envio de cada mensagem. iniciado_em / enviada_em continuam como auditoria
-- (quando o registro foi lançado no sistema).

-- ─── cobranca_casos.data_inicio ──────────────────────────────────────────────
ALTER TABLE public.cobranca_casos
  ADD COLUMN IF NOT EXISTS data_inicio date;

UPDATE public.cobranca_casos
   SET data_inicio = (iniciado_em AT TIME ZONE 'America/Sao_Paulo')::date
 WHERE data_inicio IS NULL;

ALTER TABLE public.cobranca_casos
  ALTER COLUMN data_inicio SET NOT NULL;

-- Histórico das alterações da data de início (linha do tempo):
-- [{ "de": "YYYY-MM-DD", "para": "YYYY-MM-DD", "em": timestamptz, "por": uuid }]
ALTER TABLE public.cobranca_casos
  ADD COLUMN IF NOT EXISTS data_inicio_historico jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP INDEX IF EXISTS public.cobranca_casos_unidade_status_idx;
CREATE INDEX IF NOT EXISTS cobranca_casos_unidade_status_idx
  ON public.cobranca_casos (unidade, status, data_inicio DESC, iniciado_em DESC);

-- ─── cobranca_mensagens.data_envio ───────────────────────────────────────────
ALTER TABLE public.cobranca_mensagens
  ADD COLUMN IF NOT EXISTS data_envio date;

UPDATE public.cobranca_mensagens
   SET data_envio = (enviada_em AT TIME ZONE 'America/Sao_Paulo')::date
 WHERE data_envio IS NULL AND enviada_em IS NOT NULL;

ALTER TABLE public.cobranca_mensagens
  DROP CONSTRAINT IF EXISTS cobranca_mensagens_envio_coerente;
ALTER TABLE public.cobranca_mensagens
  ADD CONSTRAINT cobranca_mensagens_envio_coerente
  CHECK ((enviada_em IS NULL) = (data_envio IS NULL));
