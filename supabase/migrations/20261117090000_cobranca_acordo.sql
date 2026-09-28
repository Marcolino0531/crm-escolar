-- Etapa "Acordo" na Cobrança: acompanhamento do Termo de Confissão de Dívida
-- pelas parcelas "Acordo" do Sponte até a quitação ou a quebra.
--
-- Migration SOMENTE aditiva: nenhum dado existente é alterado ou apagado e o
-- índice "um caso ativo por responsável" (cobranca_casos_ativo_unico, WHERE
-- status <> 'encerrado') continua igual — 'acordo' conta como caso ativo.

-- 1. 'acordo' passa a ser um status válido.
ALTER TABLE public.cobranca_casos DROP CONSTRAINT IF EXISTS cobranca_casos_status_check;
ALTER TABLE public.cobranca_casos ADD CONSTRAINT cobranca_casos_status_check
  CHECK (status IN ('mensagens','notificacao','aguardando_prazo','acordo','processo','encerrado'));

-- 2. Dados do acordo.
ALTER TABLE public.cobranca_casos
  ADD COLUMN IF NOT EXISTS acordo_documento_id uuid REFERENCES public.documentos_recibos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acordo_registrado_em timestamptz,
  ADD COLUMN IF NOT EXISTS acordo_registrado_por uuid,
  ADD COLUMN IF NOT EXISTS acordo_etapa_anterior text,
  ADD COLUMN IF NOT EXISTS acordo_quebrado_em timestamptz,
  ADD COLUMN IF NOT EXISTS acordo_quebrado_por uuid;

-- Um termo só pode estar ligado a um caso.
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_casos_acordo_documento_unico
  ON public.cobranca_casos (acordo_documento_id)
  WHERE acordo_documento_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
