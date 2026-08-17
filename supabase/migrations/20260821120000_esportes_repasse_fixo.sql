-- Esportes Extracurriculares — múltiplos parceiros por modalidade e repasse em
-- valor fixo mensal, ao lado do percentual que já existia.
--
-- Duas formas de contrato, escolhidas por modalidade e nunca misturadas:
--
-- percentual — cada parceiro leva um % do arrecadado (modelo original, Jazz
--   70/30). A soma dos percentuais não pode passar de 100.
-- fixo — cada parceiro tem um valor mensal GARANTIDO (Jiu-Jitsu: R$ 1.200 do
--   professor + R$ 800 do auxiliar), que não se move quando entra ou sai aluno.
--   O colégio absorve a diferença contra o arrecadado, para cima ou para baixo.
--
-- O parceiro deixa de ser uma coluna da modalidade e passa a ser uma linha em
-- esportes_parceiros; o repasse deixa de ser um por mês e passa a ser um por
-- parceiro por mês.

-- ---------- Cadastro da modalidade ----------

ALTER TABLE public.esportes_modalidades
  ADD COLUMN IF NOT EXISTS tipo_repasse text NOT NULL DEFAULT 'percentual',
  -- Só fazem sentido no fixo: dia do mês em que o repasse deve ser lançado e o
  -- mês a partir do qual a modalidade existe.
  ADD COLUMN IF NOT EXISTS dia_pagamento smallint,
  ADD COLUMN IF NOT EXISTS mes_inicio text;

ALTER TABLE public.esportes_modalidades
  DROP CONSTRAINT IF EXISTS esportes_modalidades_tipo_chk;
ALTER TABLE public.esportes_modalidades
  ADD CONSTRAINT esportes_modalidades_tipo_chk CHECK (tipo_repasse IN ('percentual', 'fixo'));

ALTER TABLE public.esportes_modalidades
  DROP CONSTRAINT IF EXISTS esportes_modalidades_dia_chk;
ALTER TABLE public.esportes_modalidades
  ADD CONSTRAINT esportes_modalidades_dia_chk
  CHECK (dia_pagamento IS NULL OR (dia_pagamento >= 1 AND dia_pagamento <= 31));

ALTER TABLE public.esportes_modalidades
  DROP CONSTRAINT IF EXISTS esportes_modalidades_mes_inicio_chk;
ALTER TABLE public.esportes_modalidades
  ADD CONSTRAINT esportes_modalidades_mes_inicio_chk
  CHECK (mes_inicio IS NULL OR mes_inicio ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- ---------- Parceiros da modalidade ----------

CREATE TABLE IF NOT EXISTS public.esportes_parceiros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modalidade_id uuid NOT NULL REFERENCES public.esportes_modalidades (id) ON DELETE CASCADE,
  nome text NOT NULL,
  -- Um dos dois, conforme o tipo_repasse da modalidade. O outro fica NULL de
  -- propósito: valor zerado e "não se aplica" são coisas diferentes aqui.
  percentual_parceiro numeric(5, 2) CHECK (percentual_parceiro IS NULL OR (percentual_parceiro >= 0 AND percentual_parceiro <= 100)),
  valor_fixo_mensal numeric(12, 2) CHECK (valor_fixo_mensal IS NULL OR valor_fixo_mensal >= 0),
  -- Ordem de exibição (professor antes do auxiliar, por exemplo).
  ordem smallint NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT esportes_parceiros_nome_key UNIQUE (modalidade_id, nome)
);

-- Um parceiro tem percentual OU valor fixo, nunca os dois: a modalidade define
-- qual dos dois vale, e guardar os dois abriria espaço para pagar em dobro.
ALTER TABLE public.esportes_parceiros
  DROP CONSTRAINT IF EXISTS esportes_parceiros_valor_chk;
ALTER TABLE public.esportes_parceiros
  ADD CONSTRAINT esportes_parceiros_valor_chk
  CHECK (
    (percentual_parceiro IS NOT NULL AND valor_fixo_mensal IS NULL)
    OR (percentual_parceiro IS NULL AND valor_fixo_mensal IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS esportes_parceiros_modalidade_idx
  ON public.esportes_parceiros (modalidade_id);

DROP TRIGGER IF EXISTS esportes_parceiros_set_updated_at ON public.esportes_parceiros;
CREATE TRIGGER esportes_parceiros_set_updated_at BEFORE UPDATE ON public.esportes_parceiros
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Repasse por parceiro ----------

ALTER TABLE public.esportes_repasses
  ADD COLUMN IF NOT EXISTS parceiro_id uuid REFERENCES public.esportes_parceiros (id) ON DELETE CASCADE,
  -- Valor combinado à mão para ESTE mês (mês parcial, acerto pontual). NULL =
  -- vale o valor do cadastro. É também o sinal de "mês ajustado" na tela.
  ADD COLUMN IF NOT EXISTS valor_ajustado numeric(12, 2);

ALTER TABLE public.esportes_repasses
  DROP CONSTRAINT IF EXISTS esportes_repasses_ajuste_chk;
ALTER TABLE public.esportes_repasses
  ADD CONSTRAINT esportes_repasses_ajuste_chk
  CHECK (valor_ajustado IS NULL OR valor_ajustado >= 0);

-- ---------- Migração do parceiro único para a nova tabela ----------
-- Cada modalidade existente vira uma modalidade percentual com um parceiro, e os
-- repasses já registrados passam a apontar para ele.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'esportes_modalidades'
      AND column_name = 'parceiro_nome'
  ) THEN
    INSERT INTO public.esportes_parceiros (
      modalidade_id, nome, percentual_parceiro, ordem, created_by, created_by_nome
    )
    SELECT m.id, m.parceiro_nome, m.percentual_parceiro, 0, m.created_by, m.created_by_nome
      FROM public.esportes_modalidades m
     WHERE NOT EXISTS (
       SELECT 1 FROM public.esportes_parceiros p WHERE p.modalidade_id = m.id
     )
    ON CONFLICT (modalidade_id, nome) DO NOTHING;

    UPDATE public.esportes_repasses r
       SET parceiro_id = p.id
      FROM public.esportes_parceiros p
     WHERE p.modalidade_id = r.modalidade_id
       AND r.parceiro_id IS NULL;

    ALTER TABLE public.esportes_modalidades
      DROP COLUMN parceiro_nome,
      DROP COLUMN percentual_parceiro;
  END IF;
END $$;

-- Um registro por parceiro por mês (antes era um por modalidade por mês).
ALTER TABLE public.esportes_repasses
  DROP CONSTRAINT IF EXISTS esportes_repasses_mes_key;
CREATE UNIQUE INDEX IF NOT EXISTS esportes_repasses_parceiro_mes_key
  ON public.esportes_repasses (modalidade_id, mes_referencia, parceiro_id);

-- Sem parceiro o índice acima não protege nada (NULL não colide com NULL), então
-- a coluna passa a ser obrigatória. Só acontece se a migração acima cobriu todas
-- as linhas: se sobrou alguma órfã, ela fica visível para conferência manual em
-- vez de derrubar a migração inteira.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.esportes_repasses WHERE parceiro_id IS NULL) THEN
    ALTER TABLE public.esportes_repasses ALTER COLUMN parceiro_id SET NOT NULL;
  ELSE
    RAISE WARNING 'esportes_repasses tem linhas sem parceiro_id; parceiro_id segue opcional';
  END IF;
END $$;

-- ---------- RLS ----------
-- Mesma regra das outras tabelas do módulo: leitura por modalidade visível
-- (o parceiro externo vê só as dele), escrita apenas para o colégio.

ALTER TABLE public.esportes_parceiros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "esportes view parceiros" ON public.esportes_parceiros;
CREATE POLICY "esportes view parceiros" ON public.esportes_parceiros
  FOR SELECT TO authenticated
  USING (public.can_view_modalidade_esporte(auth.uid(), modalidade_id));

DROP POLICY IF EXISTS "esportes insert parceiros" ON public.esportes_parceiros;
CREATE POLICY "esportes insert parceiros" ON public.esportes_parceiros
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

DROP POLICY IF EXISTS "esportes update parceiros" ON public.esportes_parceiros;
CREATE POLICY "esportes update parceiros" ON public.esportes_parceiros
  FOR UPDATE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()))
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

DROP POLICY IF EXISTS "esportes delete parceiros" ON public.esportes_parceiros;
CREATE POLICY "esportes delete parceiros" ON public.esportes_parceiros
  FOR DELETE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()));

NOTIFY pgrst, 'reload schema';
