-- Itens do material pedagógico ganham periodicidade dos volumes (por semestre /
-- por ano) e um tipo alternativo de descrição livre ("materiais usados nas
-- aulas práticas"), no lugar de uma quantidade de volumes.
--
-- Itens existentes continuam como 'volumes' sem periodicidade: o rótulo
-- permanece "<nome> — N volume(s)" até serem editados (a periodicidade passa a
-- ser obrigatória na edição).

ALTER TABLE public.material_pedagogico_itens
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'volumes',
  ADD COLUMN IF NOT EXISTS periodicidade text,
  ADD COLUMN IF NOT EXISTS descricao text;

ALTER TABLE public.material_pedagogico_itens
  ALTER COLUMN quantidade DROP NOT NULL,
  ALTER COLUMN quantidade DROP DEFAULT;

ALTER TABLE public.material_pedagogico_itens
  DROP CONSTRAINT IF EXISTS material_pedagogico_itens_quantidade_check,
  DROP CONSTRAINT IF EXISTS material_pedagogico_itens_tipo_check,
  DROP CONSTRAINT IF EXISTS material_pedagogico_itens_periodicidade_check,
  DROP CONSTRAINT IF EXISTS material_pedagogico_itens_coerente;

ALTER TABLE public.material_pedagogico_itens
  ADD CONSTRAINT material_pedagogico_itens_quantidade_check
    CHECK (quantidade IS NULL OR quantidade > 0),
  ADD CONSTRAINT material_pedagogico_itens_tipo_check
    CHECK (tipo IN ('volumes', 'descricao')),
  ADD CONSTRAINT material_pedagogico_itens_periodicidade_check
    CHECK (periodicidade IS NULL OR periodicidade IN ('semestre', 'ano')),
  ADD CONSTRAINT material_pedagogico_itens_coerente
    CHECK (
      (tipo = 'volumes' AND quantidade IS NOT NULL AND descricao IS NULL)
      OR
      (tipo = 'descricao' AND descricao IS NOT NULL AND btrim(descricao) <> ''
        AND quantidade IS NULL AND periodicidade IS NULL)
    );
