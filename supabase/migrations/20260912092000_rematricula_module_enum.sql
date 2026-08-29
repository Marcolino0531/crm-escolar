-- Novo módulo "Rematrícula" — tela interna de acompanhamento do formulário
-- público e aprovação do lançamento do material pedagógico no Sponte.
--
-- Em uma migration ISOLADA (própria transação): no Postgres, um valor
-- recém-adicionado a um enum não pode ser usado na MESMA transação em que foi
-- criado. As policies que referenciam 'rematricula'::public.app_module ficam na
-- migration seguinte.
--
-- VISIBILIDADE (DEFAULT DENY): can_view_module/can_edit_module só liberam via
-- user_permissions (ou admin), então o módulo nasce invisível para todos até o
-- Administrador conceder acesso na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rematricula';
