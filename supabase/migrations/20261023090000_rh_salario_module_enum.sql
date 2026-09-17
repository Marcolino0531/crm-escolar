-- Módulo dedicado 'rh_salario' para a sub-visão "Salário" de RH → Pagamentos,
-- no mesmo padrão de 'diario_financeiro' / 'dashboard':
--
--   • 'rh'         → lista de Pessoal, Vale Transporte, Contracheques, Folha
--                    de Ponto, Estatística (inalterado).
--   • 'rh_salario' → ver (can_view) e cadastrar/editar (can_edit) o salário
--                    base por funcionário e competência.
--
-- DEFAULT DENY: ninguém ganha 'rh_salario' automaticamente — inclusive quem já
-- edita 'rh'. O Administrador concede na Gestão de Acessos. Um valor novo de
-- enum não pode ser usado na mesma transação em que é criado, então esta
-- migration só estende o enum; a tabela de salários vem em migration própria.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh_salario';
