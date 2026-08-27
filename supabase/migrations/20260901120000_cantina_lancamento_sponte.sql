-- Lançamento automático da recarga no Sponte (InsertPlano, igual ao Fechamento
-- da Colônia): guarda a conta a receber criada, o vencimento usado e o erro da
-- última tentativa, para a equipe poder repetir sem gerar duplicidade.
ALTER TABLE public.cantina_recargas
  ADD COLUMN IF NOT EXISTS sponte_conta_receber_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sponte_vencimento date,
  ADD COLUMN IF NOT EXISTS sponte_erro text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lancada_automatica boolean NOT NULL DEFAULT false;

-- Uma recarga só pode ter UMA conta a receber no Sponte.
CREATE UNIQUE INDEX IF NOT EXISTS cantina_recargas_sponte_conta_uq
  ON public.cantina_recargas (sponte_conta_receber_id)
  WHERE sponte_conta_receber_id <> '';
