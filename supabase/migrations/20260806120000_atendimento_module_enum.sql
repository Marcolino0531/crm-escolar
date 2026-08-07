-- Novo submódulo de permissão: 'financeiro_atendimento'.
--
-- O Atendimento (chat bidirecional de WhatsApp) passa a ser um submódulo do
-- Financeiro com controle de acesso próprio (Visualizar/Editar), separado da
-- Cobrança. Antes, a tela era gateada por 'financeiro_cobranca'.
--
-- Em uma migration ISOLADA (própria transação): no Postgres, um valor
-- recém-adicionado a um enum não pode ser usado na MESMA transação. O
-- repontamento das policies das tabelas de chat fica na migration seguinte.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_atendimento';
