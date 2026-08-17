-- Esportes Extracurriculares — frequência (turma) por aluno, com preço próprio.
--
-- Uma modalidade pode ser oferecida em mais de uma frequência, cada uma com sua
-- mensalidade: o Jazz tem 2x/semana (seg e qua) a R$ 230,00 e 1x/semana (seg OU
-- qua) a R$ 210,00. A frequência é do CADASTRO da modalidade (não um enum no
-- código), para qualquer modalidade futura poder ter as suas.
--
-- O valor daqui é o ESPERADO (referência do que deveria ser cobrado do aluno). O
-- arrecadado continua sendo lido do Sponte, só do que foi efetivamente pago — a
-- diferença entre os dois é exatamente a informação útil (aluno que não pagou).

CREATE TABLE IF NOT EXISTS public.esportes_frequencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modalidade_id uuid NOT NULL REFERENCES public.esportes_modalidades (id) ON DELETE CASCADE,
  -- Rótulo como a escola fala dele ("2x semana (seg e qua)").
  nome text NOT NULL,
  valor_mensal numeric(12, 2) NOT NULL CHECK (valor_mensal >= 0),
  ordem smallint NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT esportes_frequencias_nome_key UNIQUE (modalidade_id, nome)
);

CREATE INDEX IF NOT EXISTS esportes_frequencias_modalidade_idx
  ON public.esportes_frequencias (modalidade_id);

DROP TRIGGER IF EXISTS esportes_frequencias_set_updated_at ON public.esportes_frequencias;
CREATE TRIGGER esportes_frequencias_set_updated_at BEFORE UPDATE ON public.esportes_frequencias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Frequência do aluno na modalidade. Mudar de frequência é um UPDATE desta
-- coluna: o vínculo, a data de entrada e o histórico do aluno continuam os
-- mesmos. ON DELETE SET NULL para que apagar uma frequência do cadastro não
-- apague matrícula de aluno.
ALTER TABLE public.esportes_matriculas
  ADD COLUMN IF NOT EXISTS frequencia_id uuid
    REFERENCES public.esportes_frequencias (id) ON DELETE SET NULL;

-- Frequências do Jazz (as duas em operação hoje). Só entra se a modalidade
-- ainda não tiver nenhuma frequência cadastrada, para não sobrescrever ajuste
-- de preço feito na tela.
INSERT INTO public.esportes_frequencias (modalidade_id, nome, valor_mensal, ordem)
SELECT m.id, f.nome, f.valor, f.ordem
  FROM public.esportes_modalidades m
 CROSS JOIN (
   VALUES
     ('2x semana (seg e qua)', 230.00, 0),
     ('1x semana (segunda)', 210.00, 1),
     ('1x semana (quarta)', 210.00, 2)
 ) AS f(nome, valor, ordem)
 WHERE lower(btrim(m.nome)) = 'jazz'
   AND NOT EXISTS (
     SELECT 1 FROM public.esportes_frequencias x WHERE x.modalidade_id = m.id
   )
ON CONFLICT (modalidade_id, nome) DO NOTHING;

-- ---------- RLS ----------
-- Mesma regra das demais tabelas do módulo: leitura por modalidade visível
-- (parceiro externo vê só as dele), escrita apenas para o colégio.

ALTER TABLE public.esportes_frequencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "esportes view frequencias" ON public.esportes_frequencias;
CREATE POLICY "esportes view frequencias" ON public.esportes_frequencias
  FOR SELECT TO authenticated
  USING (public.can_view_modalidade_esporte(auth.uid(), modalidade_id));

DROP POLICY IF EXISTS "esportes insert frequencias" ON public.esportes_frequencias;
CREATE POLICY "esportes insert frequencias" ON public.esportes_frequencias
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

DROP POLICY IF EXISTS "esportes update frequencias" ON public.esportes_frequencias;
CREATE POLICY "esportes update frequencias" ON public.esportes_frequencias
  FOR UPDATE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()))
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

DROP POLICY IF EXISTS "esportes delete frequencias" ON public.esportes_frequencias;
CREATE POLICY "esportes delete frequencias" ON public.esportes_frequencias
  FOR DELETE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()));

NOTIFY pgrst, 'reload schema';
