-- Novo submódulo do Financeiro: "Cartão de Crédito" (Controle de Recebíveis).
--
-- Adiciona o valor 'financeiro_cartao' ao enum public.app_module em uma migration
-- ISOLADA (própria transação): no Postgres, um valor recém-adicionado a um enum
-- não pode ser usado na MESMA transação em que foi criado. A tabela e as policies
-- que referenciam 'financeiro_cartao'::public.app_module ficam na migration seguinte.
--
-- VISIBILIDADE (DEFAULT DENY): como can_view_module/can_edit_module só liberam via
-- user_permissions (ou admin), o submódulo nasce 100% invisível/bloqueado para
-- todos os usuários comuns. Só aparece quando o Administrador conceder acesso.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_cartao';
