-- Novo módulo de topo: "Dashboard" (painel gerencial principal), posicionado
-- acima do grupo "MÓDULOS" no menu lateral e definido como página inicial.
--
-- Adiciona o valor 'dashboard' ao enum public.app_module. Em uma migration
-- ISOLADA (própria transação): no Postgres, um valor recém-adicionado a um enum
-- não pode ser usado na MESMA transação em que foi criado.
--
-- VISIBILIDADE (DEFAULT DENY): como can_view_module/can_edit_module só liberam
-- via user_permissions (ou admin), o módulo nasce 100% invisível para usuários
-- comuns. Só aparece quando o Administrador conceder acesso na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'dashboard';
