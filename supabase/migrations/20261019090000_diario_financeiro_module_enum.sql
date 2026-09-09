-- Divide o módulo "Diário do Aluno" em dois níveis de acesso, no mesmo padrão
-- de 'colonia' / 'colonia_financeiro':
--
--   • 'diario'            → OPERACIONAL: abas "Registro" e "Consumos Extras"
--                           (registros de refeição/entrada/saída, sem valores).
--   • 'diario_financeiro' → FINANCEIRO: abas "Auditoria Sponte", "Tabela de
--                           Preços" e "Faturamento" (preços, títulos no Sponte,
--                           isenção de consumo).
--
-- As telas financeiras leem e escrevem só via server functions (service role),
-- que checam can_view_module/can_edit_module com 'diario_financeiro'; por isso
-- não há policy a ajustar aqui. Um valor novo de enum não pode ser usado na
-- mesma transação em que é criado, então esta migration só estende o enum.
--
-- DEFAULT DENY: ninguém ganha o nível Financeiro automaticamente — inclusive
-- quem já tem 'diario'. O Administrador concede na Gestão de Acessos.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'diario_financeiro';
