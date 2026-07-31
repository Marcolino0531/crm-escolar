-- Reprocessamento de matrículas pelo Dashboard de Matrículas.
--
-- A submissão que falhou é reenviada ao Sponte a partir do payload original e a
-- MESMA linha é atualizada (não se cria um segundo registro), preservando o
-- histórico da tentativa: quantas vezes rodou, quando e por quem.

ALTER TABLE public.enrollment_submissions
  ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reprocessado_em timestamptz,
  ADD COLUMN IF NOT EXISTS reprocessado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL;
