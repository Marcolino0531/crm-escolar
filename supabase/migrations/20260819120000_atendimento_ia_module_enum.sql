-- Novo submódulo de permissão: 'financeiro_atendimento_ia'.
--
-- O assistente de IA do Atendimento manda histórico de conversa e situação
-- financeira do aluno para um serviço EXTERNO (API da Anthropic) e tem custo por
-- uso, então ganha permissão própria, separada do Atendimento: quem responde no
-- chat não passa automaticamente a poder gerar sugestões.
--
-- Em uma migration ISOLADA (própria transação): no Postgres, um valor
-- recém-adicionado a um enum não pode ser usado na MESMA transação. As tabelas e
-- policies que referenciam este valor ficam na migration seguinte.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_atendimento_ia';
