-- Módulo Documentos — histórico compartilhado por TIPO de documento.
--
-- A tabela de recibos passa a guardar todo documento emitido (recibo,
-- declaração de inexistência de débitos e o que vier depois). O sequencial, o
-- snapshot e as policies continuam os mesmos; só passa a existir a coluna
-- `tipo`, com default 'recibo' para que os documentos já emitidos sigam sendo
-- lidos como recibo sem backfill.
--
-- Documentos sem valor (declaração) gravam valor_total = 0 e itens = [].

ALTER TABLE public.documentos_recibos
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'recibo';

-- Sem CHECK de valores: um modelo novo entra só no catálogo da aplicação, sem
-- migration. Recibo exige responsável (é quem paga); a declaração é sobre o
-- aluno e pode não ter responsável citado, daí responsavel_nome default ''.

CREATE INDEX IF NOT EXISTS documentos_recibos_tipo_data_idx
  ON public.documentos_recibos (tipo, data_recibo DESC);
