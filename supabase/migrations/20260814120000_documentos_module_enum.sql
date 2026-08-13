-- Novo módulo "Documentos" — emissão de documentos oficiais do colégio a partir
-- dos dados do Sponte, começando pelo recibo de pagamento.
--
-- Em uma migration ISOLADA (própria transação): no Postgres, um valor
-- recém-adicionado a um enum não pode ser usado na MESMA transação em que foi
-- criado. As tabelas e as policies que referenciam 'documentos'::public.app_module
-- ficam na migration seguinte.
--
-- VISIBILIDADE (DEFAULT DENY): can_view_module/can_edit_module só liberam via
-- user_permissions (ou admin), então o módulo nasce invisível para todos até o
-- Administrador conceder acesso na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'documentos';
