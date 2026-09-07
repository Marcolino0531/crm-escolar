-- Rematrícula por ano letivo: campanhas (abrir/fechar por ano), valor da
-- Matrícula por segmento e ano, ano nos links/sessões/acessos e unicidade por
-- (unidade, aluno_id, ano_letivo) nas tabelas do portal.
--
-- `rematricula_config.ano_vigente` (Diário do Aluno) não muda: continua a
-- configuração administrativa única. `rematricula_config.ano_letivo` deixa de
-- ser lido pelo código; a verdade passa a ser `rematricula_campanhas`.

-- ─── Campanhas por ano ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rematricula_campanhas (
  ano_letivo integer PRIMARY KEY CHECK (ano_letivo BETWEEN 2024 AND 2100),
  aberta boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

ALTER TABLE public.rematricula_campanhas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rematricula_campanhas_select ON public.rematricula_campanhas;
CREATE POLICY rematricula_campanhas_select ON public.rematricula_campanhas
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));

-- A campanha em andamento hoje (2027) nasce aberta; se ainda não houver
-- configuração, 2027 é criada aberta do mesmo jeito.
INSERT INTO public.rematricula_campanhas (ano_letivo, aberta, updated_by, updated_by_nome)
SELECT c.ano_letivo, true, c.updated_by, c.updated_by_nome
FROM public.rematricula_config c
WHERE c.id = true
ON CONFLICT (ano_letivo) DO NOTHING;

INSERT INTO public.rematricula_campanhas (ano_letivo, aberta)
SELECT 2027, true
WHERE NOT EXISTS (SELECT 1 FROM public.rematricula_campanhas)
ON CONFLICT (ano_letivo) DO NOTHING;

-- ─── Valor da Matrícula por segmento e ano ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rematricula_matricula_valores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  segmento text NOT NULL CHECK (segmento IN ('infantil_fundamental_1', 'fundamental_2')),
  valor numeric(12, 2) NOT NULL CHECK (valor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS rematricula_matricula_valores_unico_idx
  ON public.rematricula_matricula_valores (ano_letivo, segmento);

ALTER TABLE public.rematricula_matricula_valores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rematricula_matricula_valores_select ON public.rematricula_matricula_valores;
CREATE POLICY rematricula_matricula_valores_select ON public.rematricula_matricula_valores
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));

-- Valores que estavam fixos no código, agora como cadastro de 2027.
INSERT INTO public.rematricula_matricula_valores (ano_letivo, segmento, valor)
VALUES (2027, 'infantil_fundamental_1', 2057.10), (2027, 'fundamental_2', 2234.25)
ON CONFLICT (ano_letivo, segmento) DO NOTHING;

-- ─── Ano letivo nos links, sessões, acessos e responsável financeiro ────────

DO $$
DECLARE
  ano_atual integer;
BEGIN
  SELECT ano_letivo INTO ano_atual FROM public.rematricula_config WHERE id = true;
  IF ano_atual IS NULL THEN
    ano_atual := 2027;
  END IF;

  ALTER TABLE public.rematricula_links ADD COLUMN IF NOT EXISTS ano_letivo integer;
  EXECUTE format('UPDATE public.rematricula_links SET ano_letivo = %s WHERE ano_letivo IS NULL', ano_atual);
  ALTER TABLE public.rematricula_links ALTER COLUMN ano_letivo SET NOT NULL;

  ALTER TABLE public.rematricula_sessoes ADD COLUMN IF NOT EXISTS ano_letivo integer;
  EXECUTE format('UPDATE public.rematricula_sessoes SET ano_letivo = %s WHERE ano_letivo IS NULL', ano_atual);
  ALTER TABLE public.rematricula_sessoes ALTER COLUMN ano_letivo SET NOT NULL;

  ALTER TABLE public.rematricula_acessos ADD COLUMN IF NOT EXISTS ano_letivo integer;
  EXECUTE format('UPDATE public.rematricula_acessos SET ano_letivo = %s WHERE ano_letivo IS NULL', ano_atual);
  ALTER TABLE public.rematricula_acessos ALTER COLUMN ano_letivo SET NOT NULL;

  ALTER TABLE public.rematricula_responsavel_financeiro ADD COLUMN IF NOT EXISTS ano_letivo integer;
  EXECUTE format('UPDATE public.rematricula_responsavel_financeiro SET ano_letivo = %s WHERE ano_letivo IS NULL', ano_atual);
  ALTER TABLE public.rematricula_responsavel_financeiro ALTER COLUMN ano_letivo SET NOT NULL;

  -- Tabelas que já tinham a coluna, mas permitiam nulo.
  EXECUTE format('UPDATE public.rematricula_escolhas SET ano_letivo = %s WHERE ano_letivo IS NULL', ano_atual);
  ALTER TABLE public.rematricula_escolhas ALTER COLUMN ano_letivo SET NOT NULL;

  EXECUTE format('UPDATE public.rematricula_matricula_escolhas SET ano_letivo = %s WHERE ano_letivo IS NULL', ano_atual);
  ALTER TABLE public.rematricula_matricula_escolhas ALTER COLUMN ano_letivo SET NOT NULL;

  EXECUTE format('UPDATE public.rematricula_envios SET ano_letivo = %s WHERE ano_letivo IS NULL', ano_atual);
  ALTER TABLE public.rematricula_envios ALTER COLUMN ano_letivo SET NOT NULL;
END $$;

-- ─── Unicidade por (unidade, aluno_id, ano_letivo) ──────────────────────────

DROP INDEX IF EXISTS public.rematricula_escolhas_aluno_idx;
CREATE UNIQUE INDEX IF NOT EXISTS rematricula_escolhas_aluno_ano_idx
  ON public.rematricula_escolhas (unidade, aluno_id, ano_letivo);

DROP INDEX IF EXISTS public.rematricula_matricula_escolhas_aluno_idx;
CREATE UNIQUE INDEX IF NOT EXISTS rematricula_matricula_escolhas_aluno_ano_idx
  ON public.rematricula_matricula_escolhas (unidade, aluno_id, ano_letivo);

DROP INDEX IF EXISTS public.rematricula_envios_aluno_idx;
CREATE UNIQUE INDEX IF NOT EXISTS rematricula_envios_aluno_ano_idx
  ON public.rematricula_envios (unidade, aluno_id, ano_letivo);

DROP INDEX IF EXISTS public.rematricula_responsavel_financeiro_aluno_idx;
CREATE UNIQUE INDEX IF NOT EXISTS rematricula_responsavel_financeiro_aluno_ano_idx
  ON public.rematricula_responsavel_financeiro (unidade, aluno_id, ano_letivo);

ALTER TABLE public.rematricula_acessos DROP CONSTRAINT IF EXISTS rematricula_acessos_pkey;
ALTER TABLE public.rematricula_acessos ADD PRIMARY KEY (unidade, aluno_id, ano_letivo);
