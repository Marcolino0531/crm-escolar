-- Novo módulo "Colônia de Férias" — serviço avulso (pago por uso) de registro
-- diário de refeições e portaria (entrada/saída) das crianças, reaproveitando
-- a mesma base de alunos/turmas já sincronizada do Sponte (módulo Diário), mas
-- com uma tabela de registros TOTALMENTE INDEPENDENTE (public.holiday_camp_records).
--
-- Adiciona o valor 'colonia' ao enum public.app_module numa migration ISOLADA
-- (própria transação): no Postgres, um valor recém-adicionado a um enum não pode
-- ser usado na MESMA transação em que foi criado. As tabelas e policies que
-- referenciam 'colonia'::public.app_module ficam na migration seguinte.
--
-- VISIBILIDADE (DEFAULT DENY): como can_view_module/can_edit_module só liberam
-- via user_permissions (ou admin), o módulo nasce 100% invisível/bloqueado para
-- todos os usuários comuns. Só passa a aparecer quando o Administrador conceder
-- explicitamente Visualização/Edição na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'colonia';
