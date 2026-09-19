-- Módulo 'pedagogico' (Secretaria / Portal do Professor — Fase 0), no mesmo
-- padrão de 'biblioteca' / 'rh_salario': DEFAULT DENY, concedido na Gestão de
-- Acessos. Um valor novo de enum não pode ser usado na mesma transação em que
-- é criado, então esta migration só estende o enum; as tabelas vêm em
-- migration própria.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'pedagogico';
