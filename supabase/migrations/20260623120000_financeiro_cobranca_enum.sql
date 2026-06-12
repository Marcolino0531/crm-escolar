-- Renomeação da chave do módulo de Cobrança: 'cobranca' → 'financeiro_cobranca'.
--
-- A Cobrança passa a ser um SUBMÓDULO do Financeiro (mesmo padrão de
-- financeiro_inadimplencia, financeiro_fundos, etc.), tanto na matriz de
-- permissões quanto na visibilidade em cadeia (Financeiro macro + submódulo).
--
-- Em uma migration ISOLADA (própria transação): no Postgres, um valor
-- recém-adicionado a um enum não pode ser usado na MESMA transação. A migração
-- dos dados (user_permissions) e o repontamento das policies ficam na migration
-- seguinte. O valor antigo 'cobranca' é mantido no enum (Postgres não suporta
-- DROP VALUE) porém deixa de ser usado pela aplicação.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_cobranca';
