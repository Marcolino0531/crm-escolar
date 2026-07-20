-- Acordo manual / "Já lançado" no Fechamento Semanal da Colônia.
--
-- Permite resolver o fechamento semanal de um aluno SEM faturar no Sponte —
-- usado quando a escola negocia um valor diferenciado direto com o responsável,
-- ignorando o cálculo automático. Reusa holiday_camp_invoices: a linha marca o
-- aluno como resolvido naquela semana (sai da pendência do School Hub), com
-- manual_settlement = true e sem sponte_conta_receber_id.
--
-- Continua escrito EXCLUSIVAMENTE via server function (service role). A coluna é
-- lida pelo Fechamento Semanal para exibir o estado "Já lançado / Acordo manual"
-- e para o watcher de invalidação NÃO reverter acordos manuais.

ALTER TABLE public.holiday_camp_invoices
  ADD COLUMN IF NOT EXISTS manual_settlement boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
