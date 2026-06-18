-- Novo módulo "Agenda" (visão de calendário das visitas/reuniões agendadas).
--
-- Adiciona o valor 'agenda' ao enum public.app_module.
--
-- VISIBILIDADE (DEFAULT DENY): seguindo a regra de segurança do sistema, todo
-- módulo novo nasce 100% invisível/bloqueado para usuários comuns. Como
-- can_view_module/can_edit_module só liberam via user_permissions (ou admin),
-- não há backfill aqui: o módulo só passa a aparecer quando o Administrador
-- conceder Visualização/Edição explicitamente na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'agenda';
