-- Esportes Extracurriculares — modalidades com parceiro externo, alunos
-- matriculados, e o repasse mensal calculado sobre o que foi efetivamente pago.
--
-- O valor arrecadado NÃO é digitado nem replicado: ele é lido do Sponte no
-- momento em que o painel é aberto (parcelas do aluno cuja Categoria é a da
-- modalidade). O que fica gravado aqui é apenas o cadastro (modalidade,
-- parceiro, percentual, alunos) e o REGISTRO DO REPASSE — o snapshot do que foi
-- calculado no fechamento do mês e a data em que o dinheiro foi transferido.
--
-- ACESSO POR MODALIDADE (não só por módulo): o parceiro é externo à escola, e
-- recebe apenas o módulo 'esportes' + uma ou mais linhas em
-- esportes_modalidade_acessos. Com pelo menos uma linha, ele passa a ver
-- SOMENTE as modalidades dela(s) — inclusive alunos e repasses. Usuário interno
-- com o módulo e sem nenhuma linha continua vendo todas as modalidades.

CREATE TABLE IF NOT EXISTS public.esportes_modalidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  -- Categoria como ela aparece no boleto do Sponte (ex.: "Teatro"). É por ela
  -- que o valor pago da modalidade é identificado dentro da mensalidade.
  categoria_sponte text NOT NULL,
  parceiro_nome text NOT NULL,
  -- Percentual contratual do parceiro sobre o arrecadado da modalidade.
  percentual_parceiro numeric(5, 2) NOT NULL CHECK (percentual_parceiro >= 0 AND percentual_parceiro <= 100),
  unidade text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT esportes_modalidades_nome_key UNIQUE (nome, unidade)
);

CREATE TABLE IF NOT EXISTS public.esportes_matriculas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modalidade_id uuid NOT NULL REFERENCES public.esportes_modalidades (id) ON DELETE CASCADE,
  aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  turma text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT esportes_matriculas_aluno_key UNIQUE (modalidade_id, aluno_id)
);

CREATE INDEX IF NOT EXISTS esportes_matriculas_modalidade_idx
  ON public.esportes_matriculas (modalidade_id);

CREATE TABLE IF NOT EXISTS public.esportes_repasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modalidade_id uuid NOT NULL REFERENCES public.esportes_modalidades (id) ON DELETE CASCADE,
  -- Mês de competência (YYYY-MM), pelo vencimento da parcela no Sponte.
  mes_referencia text NOT NULL,
  -- Snapshot do fechamento: o que o Sponte mostrava quando o repasse foi
  -- registrado. Preserva a auditoria mesmo que uma baixa mude depois.
  valor_arrecadado numeric(12, 2) NOT NULL DEFAULT 0,
  percentual_parceiro numeric(5, 2) NOT NULL DEFAULT 0,
  valor_repasse numeric(12, 2) NOT NULL DEFAULT 0,
  valor_retido numeric(12, 2) NOT NULL DEFAULT 0,
  -- Data da transferência ao parceiro. NULL = calculado, ainda não pago.
  pago_em date,
  observacao text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT esportes_repasses_mes_key UNIQUE (modalidade_id, mes_referencia),
  CONSTRAINT esportes_repasses_mes_chk CHECK (mes_referencia ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE IF NOT EXISTS public.esportes_modalidade_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modalidade_id uuid NOT NULL REFERENCES public.esportes_modalidades (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esportes_modalidade_acessos_key UNIQUE (modalidade_id, user_id)
);

CREATE INDEX IF NOT EXISTS esportes_modalidade_acessos_user_idx
  ON public.esportes_modalidade_acessos (user_id);

DROP TRIGGER IF EXISTS esportes_modalidades_set_updated_at ON public.esportes_modalidades;
CREATE TRIGGER esportes_modalidades_set_updated_at BEFORE UPDATE ON public.esportes_modalidades
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS esportes_repasses_set_updated_at ON public.esportes_repasses;
CREATE TRIGGER esportes_repasses_set_updated_at BEFORE UPDATE ON public.esportes_repasses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Helpers de acesso (security definer: sem recursão de RLS) ----------

-- Usuário restrito a modalidades específicas (o caso do parceiro externo).
CREATE OR REPLACE FUNCTION public.esportes_restrito_por_modalidade(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT public.has_role(_user_id, 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.esportes_modalidade_acessos WHERE user_id = _user_id
    );
$$;

-- Visibilidade de UMA modalidade: exige o módulo e, para quem é restrito, que a
-- modalidade esteja entre as dele.
CREATE OR REPLACE FUNCTION public.can_view_modalidade_esporte(_user_id uuid, _modalidade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_view_module(_user_id, 'esportes'::public.app_module)
    AND (
      NOT public.esportes_restrito_por_modalidade(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.esportes_modalidade_acessos
        WHERE user_id = _user_id AND modalidade_id = _modalidade_id
      )
    );
$$;

-- Escrita (cadastrar modalidade/aluno, registrar repasse) é do colégio: exige
-- edição do módulo e NUNCA é liberada a um parceiro restrito, que só consulta.
CREATE OR REPLACE FUNCTION public.pode_editar_esportes(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_edit_module(_user_id, 'esportes'::public.app_module)
    AND NOT public.esportes_restrito_por_modalidade(_user_id);
$$;

REVOKE EXECUTE ON FUNCTION public.esportes_restrito_por_modalidade(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_modalidade_esporte(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pode_editar_esportes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esportes_restrito_por_modalidade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_modalidade_esporte(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_editar_esportes(uuid) TO authenticated;

-- ---------- RLS ----------

ALTER TABLE public.esportes_modalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esportes_matriculas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esportes_repasses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esportes_modalidade_acessos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY[
    'esportes_modalidades',
    'esportes_matriculas',
    'esportes_repasses',
    'esportes_modalidade_acessos'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END $$;

CREATE POLICY "esportes view modalidades" ON public.esportes_modalidades
  FOR SELECT TO authenticated
  USING (public.can_view_modalidade_esporte(auth.uid(), id));

CREATE POLICY "esportes insert modalidades" ON public.esportes_modalidades
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

CREATE POLICY "esportes update modalidades" ON public.esportes_modalidades
  FOR UPDATE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()))
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

CREATE POLICY "esportes delete modalidades" ON public.esportes_modalidades
  FOR DELETE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()));

CREATE POLICY "esportes view matriculas" ON public.esportes_matriculas
  FOR SELECT TO authenticated
  USING (public.can_view_modalidade_esporte(auth.uid(), modalidade_id));

CREATE POLICY "esportes insert matriculas" ON public.esportes_matriculas
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

CREATE POLICY "esportes update matriculas" ON public.esportes_matriculas
  FOR UPDATE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()))
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

CREATE POLICY "esportes delete matriculas" ON public.esportes_matriculas
  FOR DELETE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()));

CREATE POLICY "esportes view repasses" ON public.esportes_repasses
  FOR SELECT TO authenticated
  USING (public.can_view_modalidade_esporte(auth.uid(), modalidade_id));

CREATE POLICY "esportes insert repasses" ON public.esportes_repasses
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

CREATE POLICY "esportes update repasses" ON public.esportes_repasses
  FOR UPDATE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()))
  WITH CHECK (public.pode_editar_esportes(auth.uid()));

CREATE POLICY "esportes delete repasses" ON public.esportes_repasses
  FOR DELETE TO authenticated
  USING (public.pode_editar_esportes(auth.uid()));

-- O parceiro precisa ler as PRÓPRIAS linhas de acesso (é assim que a tela sabe
-- que ele é restrito); a gestão da lista é exclusiva do Administrador, no
-- Gerenciar Acessos.
CREATE POLICY "esportes view acessos" ON public.esportes_modalidade_acessos
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "esportes manage acessos" ON public.esportes_modalidade_acessos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

NOTIFY pgrst, 'reload schema';
