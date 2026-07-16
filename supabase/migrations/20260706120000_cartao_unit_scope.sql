-- Isolamento por unidade dos recebíveis de cartão (Cartão de Crédito).
--
-- A tabela credit_card_receivables nascia sem vínculo com a unidade, então os
-- registros apareciam globalmente para todas as escolas, ignorando o seletor de
-- unidade do topo. Adiciona unit_id (referência a public.schools) para que a
-- criação capture a unidade ativa e a leitura filtre por ela.

ALTER TABLE public.credit_card_receivables
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.schools (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS credit_card_receivables_unit_idx
  ON public.credit_card_receivables (unit_id);
