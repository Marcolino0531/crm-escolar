-- Esportes Extracurriculares — turmas por horário e dias da semana por aluno.
--
-- A turma é o HORÁRIO da aula ("Educação Infantil, 1º e 2º período", 17h40–18h20):
-- é o que a professora precisa saber para quem esperar em cada aula. Os dias que
-- o aluno frequenta ficam na matrícula, e a FREQUÊNCIA passa a ser derivada deles
-- (dois dias marcados = 2x/semana), em vez de escolhida à mão.

CREATE TABLE IF NOT EXISTS public.esportes_turmas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modalidade_id uuid NOT NULL REFERENCES public.esportes_modalidades (id) ON DELETE CASCADE,
  nome text NOT NULL,
  hora_inicio time,
  hora_fim time,
  ordem smallint NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT esportes_turmas_nome_key UNIQUE (modalidade_id, nome)
);

CREATE INDEX IF NOT EXISTS esportes_turmas_modalidade_idx
  ON public.esportes_turmas (modalidade_id);

DROP TRIGGER IF EXISTS esportes_turmas_set_updated_at ON public.esportes_turmas;
CREATE TRIGGER esportes_turmas_set_updated_at BEFORE UPDATE ON public.esportes_turmas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Turma e dias do aluno. Trocar de turma ou de dias é UPDATE destas colunas: o
-- vínculo com a modalidade continua o mesmo. ON DELETE SET NULL para que apagar
-- uma turma do cadastro não apague matrícula.
ALTER TABLE public.esportes_matriculas
  ADD COLUMN IF NOT EXISTS turma_id uuid
    REFERENCES public.esportes_turmas (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dias_semana smallint[] NOT NULL DEFAULT '{}';

-- 1 = segunda … 7 = domingo (ISO), o mesmo índice usado no Diário do Aluno.
ALTER TABLE public.esportes_matriculas
  DROP CONSTRAINT IF EXISTS esportes_matriculas_dias_chk;
ALTER TABLE public.esportes_matriculas
  ADD CONSTRAINT esportes_matriculas_dias_chk
  CHECK (dias_semana <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]);

-- Quantos dias por semana a frequência representa. É o que liga os dias marcados
-- ao preço: dois dias marcados procuram a frequência com vezes_semana = 2.
ALTER TABLE public.esportes_frequencias
  ADD COLUMN IF NOT EXISTS vezes_semana smallint
    CHECK (vezes_semana IS NULL OR (vezes_semana >= 1 AND vezes_semana <= 7));

-- Frequências já cadastradas cujo nome começa com "2x"/"1x" ganham o número
-- correspondente; as demais ficam nulas para a escola preencher na tela.
UPDATE public.esportes_frequencias
   SET vezes_semana = substring(btrim(nome) from '^([1-7])[xX]')::smallint
 WHERE vezes_semana IS NULL
   AND btrim(nome) ~ '^[1-7][xX]';

-- Turmas do Jazz em operação hoje. Só entra se a modalidade ainda não tiver
-- turma cadastrada, para não sobrescrever ajuste feito na tela.
INSERT INTO public.esportes_turmas (modalidade_id, nome, hora_inicio, hora_fim, ordem)
SELECT m.id, t.nome, t.inicio::time, t.fim::time, t.ordem
  FROM public.esportes_modalidades m
 CROSS JOIN (
   VALUES
     ('Educação Infantil, 1º e 2º período', '17:40', '18:20', 0),
     ('Fundamental 1 e 2', '18:30', '19:10', 1)
 ) AS t(nome, inicio, fim, ordem)
 WHERE lower(btrim(m.nome)) = 'jazz'
   AND NOT EXISTS (
     SELECT 1 FROM public.esportes_turmas x WHERE x.modalidade_id = m.id
   )
ON CONFLICT (modalidade_id, nome) DO NOTHING;

-- ---------- RLS ----------
-- Mesma regra das demais tabelas do módulo: leitura por modalidade visível
-- (parceiro externo vê só as dele), escrita apenas para o colégio.

ALTER TABLE public.esportes_turmas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "esportes view turmas" ON public.esportes_turmas;
CREATE POLICY "esportes view turmas" ON public.esportes_turmas
  FOR SELECT TO authenticated
  USING (public.can_view_modalidade_esporte(auth.uid(), modalidade_id));

DROP POLICY IF EXISTS "esportes insert turmas" ON public.esportes_turmas;
CREATE POLICY "esportes insert turmas" ON public.esportes_turmas
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

DROP POLICY IF EXISTS "esportes update turmas" ON public.esportes_turmas;
CREATE POLICY "esportes update turmas" ON public.esportes_turmas
  FOR UPDATE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()))
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

DROP POLICY IF EXISTS "esportes delete turmas" ON public.esportes_turmas;
CREATE POLICY "esportes delete turmas" ON public.esportes_turmas
  FOR DELETE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()));

NOTIFY pgrst, 'reload schema';
