-- Valor da Matrícula por colégio e com 3 segmentos.
--
-- Antes: rematricula_matricula_valores (ano_letivo, segmento, valor) era global,
-- o mesmo valor valia para os 4 colégios, com segmentos
-- 'infantil_fundamental_1' e 'fundamental_2'.
-- Depois: uma linha por (unidade, ano_letivo, segmento) com segmentos
-- 'infantil', 'fundamental_1' e 'fundamental_2'.
--
-- Cada linha antiga (sem unidade) vira uma linha por colégio, preservando valor
-- e metadados: 'infantil_fundamental_1' desdobra em 'infantil' E 'fundamental_1';
-- 'fundamental_2' continua 'fundamental_2'. A campanha de 2027 está aberta:
-- nenhum colégio fica sem valor no momento do deploy.
--
-- rematricula_matricula_escolhas.segmento guarda histórico e NÃO é alterado.
--
-- Idempotente: pode ser executada de novo sem efeito.

BEGIN;

ALTER TABLE public.rematricula_matricula_valores
  ADD COLUMN IF NOT EXISTS unidade text;

-- Solta o CHECK antigo antes de inserir os segmentos novos.
ALTER TABLE public.rematricula_matricula_valores
  DROP CONSTRAINT IF EXISTS rematricula_matricula_valores_segmento_check;

-- O índice único antigo (ano_letivo, segmento) impediria a linha por colégio.
DROP INDEX IF EXISTS public.rematricula_matricula_valores_unico_idx;

CREATE UNIQUE INDEX IF NOT EXISTS rematricula_matricula_valores_unidade_unico_idx
  ON public.rematricula_matricula_valores (unidade, ano_letivo, segmento);

-- Desdobramento: linha antiga (unidade IS NULL) × 4 colégios × segmentos novos.
WITH colegios AS (
  SELECT unnest(ARRAY['CEC', 'CEC Baby', 'Núcleo Belvedere', 'Núcleo Vale do Sereno']) AS unidade
),
mapa AS (
  SELECT 'infantil_fundamental_1' AS antigo, 'infantil' AS novo
  UNION ALL SELECT 'infantil_fundamental_1', 'fundamental_1'
  UNION ALL SELECT 'fundamental_2', 'fundamental_2'
),
antigas AS (
  SELECT * FROM public.rematricula_matricula_valores WHERE unidade IS NULL
)
INSERT INTO public.rematricula_matricula_valores
  (unidade, ano_letivo, segmento, valor, created_at, updated_at, updated_by, updated_by_nome)
SELECT
  c.unidade, a.ano_letivo, m.novo, a.valor, a.created_at, a.updated_at, a.updated_by, a.updated_by_nome
FROM antigas a
JOIN mapa m ON m.antigo = a.segmento
CROSS JOIN colegios c
ON CONFLICT (unidade, ano_letivo, segmento) DO NOTHING;

-- Só apaga as linhas antigas depois de garantir que cada uma tem as cópias.
DO $$
DECLARE
  faltando integer;
BEGIN
  SELECT count(*) INTO faltando
  FROM public.rematricula_matricula_valores a
  CROSS JOIN unnest(ARRAY['CEC', 'CEC Baby', 'Núcleo Belvedere', 'Núcleo Vale do Sereno']) AS c(unidade)
  CROSS JOIN LATERAL (
    SELECT unnest(
      CASE a.segmento
        WHEN 'infantil_fundamental_1' THEN ARRAY['infantil', 'fundamental_1']
        ELSE ARRAY[a.segmento]
      END
    ) AS novo
  ) m
  WHERE a.unidade IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.rematricula_matricula_valores n
      WHERE n.unidade = c.unidade AND n.ano_letivo = a.ano_letivo AND n.segmento = m.novo
    );
  IF faltando > 0 THEN
    RAISE EXCEPTION 'Desdobramento incompleto: % combinação(ões) sem cópia por colégio.', faltando;
  END IF;
END $$;

DELETE FROM public.rematricula_matricula_valores WHERE unidade IS NULL;

ALTER TABLE public.rematricula_matricula_valores
  ALTER COLUMN unidade SET NOT NULL;

ALTER TABLE public.rematricula_matricula_valores
  DROP CONSTRAINT IF EXISTS rematricula_matricula_valores_unidade_check;
ALTER TABLE public.rematricula_matricula_valores
  ADD CONSTRAINT rematricula_matricula_valores_unidade_check
  CHECK (unidade IN ('CEC', 'CEC Baby', 'Núcleo Belvedere', 'Núcleo Vale do Sereno'));

ALTER TABLE public.rematricula_matricula_valores
  ADD CONSTRAINT rematricula_matricula_valores_segmento_check
  CHECK (segmento IN ('infantil', 'fundamental_1', 'fundamental_2'));

COMMIT;
