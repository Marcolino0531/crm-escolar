-- Novo módulo "Cantina" — acompanhamento interno das solicitações de recarga do
-- cartão da cantina feitas pelos pais no portal público.
--
-- Em uma migration ISOLADA (própria transação): no Postgres, um valor
-- recém-adicionado a um enum não pode ser usado na MESMA transação em que foi
-- criado. As tabelas e policies que referenciam 'cantina'::public.app_module
-- ficam na migration seguinte.
--
-- VISIBILIDADE (DEFAULT DENY): can_view_module/can_edit_module só liberam via
-- user_permissions (ou admin), então o módulo nasce invisível para todos até o
-- Administrador conceder acesso na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'cantina';
