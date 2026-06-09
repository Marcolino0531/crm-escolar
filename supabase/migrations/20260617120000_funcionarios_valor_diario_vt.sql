-- Valor diário do Vale-Transporte (VT) por funcionário, usado no Fechamento de
-- Vale-Transporte do módulo RH. Mesma tabela/RLS de funcionarios.
alter table public.funcionarios
  add column if not exists valor_diario_vt numeric NOT NULL DEFAULT 0;
