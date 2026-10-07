-- RH > Pessoal > Efetivos: tamanho da camisa do funcionário.
-- Coluna nula, sem valor padrão e sem UPDATE: os funcionários existentes ficam
-- com nulo até o tamanho ser escolhido no cadastro. RLS, policies, triggers e
-- privilégios de public.funcionarios não mudam.

BEGIN;

ALTER TABLE public.funcionarios
  ADD COLUMN IF NOT EXISTS tamanho_camisa text;

ALTER TABLE public.funcionarios
  DROP CONSTRAINT IF EXISTS funcionarios_tamanho_camisa_check;
ALTER TABLE public.funcionarios
  ADD CONSTRAINT funcionarios_tamanho_camisa_check
    CHECK (tamanho_camisa IS NULL OR tamanho_camisa IN ('PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3'));

COMMENT ON COLUMN public.funcionarios.tamanho_camisa IS
  'Tamanho da camisa do funcionário efetivo: PP, P, M, G, GG, G1, G2 ou G3.';

COMMIT;
