-- Rematrícula: seção "Extras" do portal público e divergências pós-rematrícula.
--
-- rematricula_extras_escolhas guarda, por aluno/unidade/ano letivo, o retrato
-- do Sponte usado no pré-preenchimento (sponte_snapshot) e a seleção final do
-- responsável (selecionadas). O snapshot é gravado uma vez, no primeiro
-- carregamento do formulário, e não é substituído por leituras posteriores.
--
-- rematricula_extras_divergencias é só alerta para ação manual da secretaria:
-- nada é alterado no Sponte nem no Diário do Aluno. As linhas do aluno/ano são
-- substituídas a cada "Finalizar Matrícula".

CREATE TABLE IF NOT EXISTS public.rematricula_extras_escolhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  ano_letivo integer NOT NULL,
  -- [{ categoria, valorMensal, parcelas }] lido do Sponte no 1º carregamento.
  sponte_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  sponte_lido_em timestamptz NOT NULL DEFAULT now(),
  -- ["Almoço", ...] — última seleção do responsável.
  selecionadas jsonb NOT NULL DEFAULT '[]'::jsonb,
  finalizada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rematricula_extras_escolhas_aluno_ano_idx
  ON public.rematricula_extras_escolhas (unidade, aluno_id, ano_letivo);

CREATE TABLE IF NOT EXISTS public.rematricula_extras_divergencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  ano_letivo integer NOT NULL,
  categoria text NOT NULL,
  tipo text NOT NULL
    CHECK (tipo IN ('inconsistente', 'remocao_pendente', 'lancamento_pendente')),
  valor numeric(12, 2),
  mensagem text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rematricula_extras_divergencias_unidade_ano_idx
  ON public.rematricula_extras_divergencias (unidade, ano_letivo);

ALTER TABLE public.rematricula_extras_escolhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rematricula_extras_divergencias ENABLE ROW LEVEL SECURITY;

-- Escrita só pelo servidor (service role); leitura interna pelos módulos.
DROP POLICY IF EXISTS rematricula_extras_escolhas_select ON public.rematricula_extras_escolhas;
CREATE POLICY rematricula_extras_escolhas_select ON public.rematricula_extras_escolhas
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));

DROP POLICY IF EXISTS rematricula_extras_divergencias_select ON public.rematricula_extras_divergencias;
CREATE POLICY rematricula_extras_divergencias_select ON public.rematricula_extras_divergencias
  FOR SELECT TO authenticated
  USING (
    public.can_view_module(auth.uid(), 'rematricula'::public.app_module)
    OR public.can_view_module(auth.uid(), 'diario'::public.app_module)
  );
