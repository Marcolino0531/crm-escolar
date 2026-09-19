-- Módulo dedicado 'biblioteca' (acervo, empréstimos, devoluções e multas da
-- biblioteca de cada colégio), no mesmo padrão de 'esportes' / 'rh_salario'.
--
-- DEFAULT DENY: ninguém ganha 'biblioteca' automaticamente. O Administrador
-- concede na Gestão de Acessos. Um valor novo de enum não pode ser usado na
-- mesma transação em que é criado, então esta migration só estende o enum; as
-- tabelas vêm em migration própria.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'biblioteca';
