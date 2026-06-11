-- Faturamento retroativo (Janeiro a Maio) por unidade escolar.
-- O sistema só passou a registrar receitas reais a partir de Junho/2026; para
-- compor o "Faturamento Total do Ano" (denominador do card de Inadimplência
-- Acumulada Anual) é preciso informar manualmente, por unidade, o faturamento
-- histórico de Jan–Mai. NULL = não preenchido (o card exibe aviso amigável).
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS faturamento_retroativo_jan_mai numeric;

COMMENT ON COLUMN public.schools.faturamento_retroativo_jan_mai IS
  'Faturamento histórico Jan–Mai (R$) informado manualmente por unidade. Usado no denominador da Inadimplência Acumulada do ano. NULL = não configurado.';

-- A escrita já é restrita a administradores pelas policies existentes de
-- public.schools (admin insert/update/delete). O SELECT segue aberto para
-- usuários autenticados, permitindo a leitura do valor no card e nas Configurações.
