-- Novo módulo "Esportes Extracurriculares" — controle da parceria comercial das
-- modalidades extracurriculares (teatro, jiujitsu, jazz…), cada uma com um
-- parceiro externo e um percentual contratual sobre o arrecadado.
--
-- Em uma migration ISOLADA (própria transação): no Postgres, um valor
-- recém-adicionado a um enum não pode ser usado na MESMA transação em que foi
-- criado. As tabelas e as policies que referenciam 'esportes'::public.app_module
-- ficam na migration seguinte.
--
-- VISIBILIDADE (DEFAULT DENY): can_view_module/can_edit_module só liberam via
-- user_permissions (ou admin), então o módulo nasce invisível para todos até o
-- Administrador conceder acesso na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'esportes';
