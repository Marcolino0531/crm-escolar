-- Novo módulo "Estoque de Material Escolar" — tabela única de controle de
-- material pedagógico por turma, compartilhada entre as quatro unidades.
--
-- Adiciona o valor 'estoque_material' ao enum public.app_module. Em uma
-- migration ISOLADA (própria transação): no Postgres, um valor recém-adicionado
-- a um enum não pode ser usado na MESMA transação em que foi criado. A tabela e
-- as policies que referenciam 'estoque_material'::public.app_module ficam na
-- migration seguinte.
--
-- VISIBILIDADE (DEFAULT DENY): como can_view_module/can_edit_module só liberam
-- via user_permissions (ou admin), o módulo nasce 100% invisível/bloqueado para
-- todos os usuários comuns. Só passa a aparecer quando o Administrador conceder
-- explicitamente Visualização/Edição na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'estoque_material';
