-- Material Pedagógico por Série passa a ser por ANO LETIVO (antes um valor único
-- por unidade × série, sobrescrito a cada campanha) e ganha a lista de itens
-- inclusos com quantidade, editável por unidade × ano × série (antes fixa no
-- código, só para o CEC e sem Maternal).

-- ── Ano letivo no valor anual ─────────────────────────────────────────────
ALTER TABLE public.material_pedagogico_series
  ADD COLUMN IF NOT EXISTS ano_letivo integer;

-- Tudo que existe hoje foi cadastrado para a campanha de 2027.
UPDATE public.material_pedagogico_series SET ano_letivo = 2027 WHERE ano_letivo IS NULL;

ALTER TABLE public.material_pedagogico_series
  ALTER COLUMN ano_letivo SET NOT NULL;

DROP INDEX IF EXISTS public.material_pedagogico_series_unica_idx;
CREATE UNIQUE INDEX IF NOT EXISTS material_pedagogico_series_ano_unica_idx
  ON public.material_pedagogico_series (unidade, ano_letivo, serie_chave);

-- ── Itens inclusos no material, com quantidade ────────────────────────────
CREATE TABLE IF NOT EXISTS public.material_pedagogico_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  ano_letivo integer NOT NULL,
  serie text NOT NULL,
  serie_chave text NOT NULL,
  nome_item text NOT NULL CHECK (btrim(nome_item) <> ''),
  quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS material_pedagogico_itens_unico_idx
  ON public.material_pedagogico_itens (unidade, ano_letivo, serie_chave, lower(btrim(nome_item)));

CREATE INDEX IF NOT EXISTS material_pedagogico_itens_serie_idx
  ON public.material_pedagogico_itens (unidade, ano_letivo, serie_chave, ordem);

ALTER TABLE public.material_pedagogico_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_pedagogico_itens_select ON public.material_pedagogico_itens;
CREATE POLICY material_pedagogico_itens_select ON public.material_pedagogico_itens
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));

-- ── Seed: listas que estavam fixas no código (CEC, 2027, 1 volume cada) ───
-- 1º e 2º Período: Coleção Principal, Eu no Mundo, Cultura Inglesa, Robótica.
-- 1º ao 5º Ano: + Material de Arte. 6º ao 9º Ano: sem Eu no Mundo.
INSERT INTO public.material_pedagogico_itens
  (unidade, ano_letivo, serie, serie_chave, nome_item, quantidade, ordem)
SELECT 'CEC', 2027, s.serie, s.serie_chave, i.nome_item, 1, i.ordem
FROM (VALUES
  ('1º Período', '1 periodo', 'infantil'),
  ('2º Período', '2 periodo', 'infantil'),
  ('1º Ano', '1 ano', 'iniciais'),
  ('2º Ano', '2 ano', 'iniciais'),
  ('3º Ano', '3 ano', 'iniciais'),
  ('4º Ano', '4 ano', 'iniciais'),
  ('5º Ano', '5 ano', 'iniciais'),
  ('6º Ano', '6 ano', 'finais'),
  ('7º Ano', '7 ano', 'finais'),
  ('8º Ano', '8 ano', 'finais'),
  ('9º Ano', '9 ano', 'finais')
) AS s (serie, serie_chave, faixa)
JOIN (VALUES
  ('Coleção Principal (Bernoulli)', 1, ARRAY['infantil', 'iniciais', 'finais']),
  ('Coleção Eu no Mundo', 2, ARRAY['infantil', 'iniciais']),
  ('Material de Arte', 3, ARRAY['iniciais', 'finais']),
  ('Cultura Inglesa', 4, ARRAY['infantil', 'iniciais', 'finais']),
  ('Robótica', 5, ARRAY['infantil', 'iniciais', 'finais'])
) AS i (nome_item, ordem, faixas)
  ON s.faixa = ANY (i.faixas)
ON CONFLICT DO NOTHING;
