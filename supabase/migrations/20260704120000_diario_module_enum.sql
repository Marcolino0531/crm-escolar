-- Novo módulo "Diário do Aluno" (integração da aplicação School Connect:
-- registro de refeições e entrada/saída dos alunos, com detecção de consumo
-- extra — refeição/horário fora do que foi contratado pela família).
--
-- Adiciona o valor 'diario' ao enum public.app_module. Em uma migration
-- ISOLADA (própria transação): no Postgres, um valor recém-adicionado a um enum
-- não pode ser usado na MESMA transação em que foi criado. As tabelas e policies
-- que referenciam 'diario'::public.app_module ficam na migration seguinte.
--
-- VISIBILIDADE (DEFAULT DENY): como can_view_module/can_edit_module só liberam
-- via user_permissions (ou admin), o módulo nasce 100% invisível/bloqueado para
-- todos os usuários comuns. Só passa a aparecer quando o Administrador conceder
-- explicitamente Visualização/Edição na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'diario';
