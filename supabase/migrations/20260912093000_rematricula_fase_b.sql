-- Rematrícula — Fase B: lançamento do material no Sponte com aprovação manual,
-- ano letivo de referência e auditoria da sincronização cadastral.
--
-- FLUXO (mesmo modelo da Cantina)
--   pendente_lancamento → efetivada → lancada
--   O responsável só deixa a escolha PENDENTE. A secretaria efetiva na tela
--   interna e é essa efetivação — atômica, filtrada pelo status atual — que
--   autoriza o InsertPlano + UpdateParcela no Sponte. Duplo clique não gera
--   cobrança duplicada porque o UPDATE só acerta a linha ainda pendente.

-- ── Ano letivo de referência do formulário ativo ──────────────────────────
-- Linha única (id fixo), trocada manualmente pela escola uma vez por ano. É
-- este ano — e não a data em que o responsável preenche o formulário — que
-- define qual mensalidade ancora a 1ª parcela do material.
CREATE TABLE IF NOT EXISTS public.rematricula_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

-- ── Escolha do parcelamento: aprovação manual e resultado no Sponte ───────
ALTER TABLE public.rematricula_escolhas
  ADD COLUMN IF NOT EXISTS valor_primeira_parcela numeric(12, 2),
  ADD COLUMN IF NOT EXISTS ano_letivo integer,
  ADD COLUMN IF NOT EXISTS efetivada_at timestamptz,
  ADD COLUMN IF NOT EXISTS efetivada_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS efetivada_por_nome text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sponte_conta_receber_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sponte_erro text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lancada_at timestamptz,
  -- Cronograma efetivamente lançado (número, valor e vencimento de cada
  -- parcela), para a tela interna mostrar o que o Sponte gravou.
  ADD COLUMN IF NOT EXISTS parcelas_lancadas jsonb,
  ADD COLUMN IF NOT EXISTS historico jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.rematricula_escolhas
  DROP CONSTRAINT IF EXISTS rematricula_escolhas_status_check;

ALTER TABLE public.rematricula_escolhas
  ADD CONSTRAINT rematricula_escolhas_status_check
  CHECK (status IN ('pendente_lancamento', 'efetivada', 'lancada'));

-- ── Auditoria da sincronização cadastral do portal ────────────────────────
-- Uma linha por CAMPO alterado, com valor antes/depois, quem editou (o
-- responsável, pelo portal público) e o resultado da escrita no Sponte.
CREATE TABLE IF NOT EXISTS public.rematricula_cadastro_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  -- 'aluno' (UpdateAlunos3) ou 'responsavel' (UpdateResponsaveis2).
  escopo text NOT NULL CHECK (escopo IN ('aluno', 'responsavel')),
  registro_id text NOT NULL DEFAULT '',
  campo text NOT NULL,
  valor_antes text NOT NULL DEFAULT '',
  valor_depois text NOT NULL DEFAULT '',
  -- O portal é público: o autor é sempre o responsável autenticado por
  -- WhatsApp naquela sessão, identificado pelo aluno da sessão.
  editado_por text NOT NULL DEFAULT 'responsavel_portal',
  resultado text NOT NULL CHECK (resultado IN ('gravado', 'falhou')),
  erro text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rematricula_cadastro_auditoria_aluno_idx
  ON public.rematricula_cadastro_auditoria (unidade, aluno_id, created_at DESC);

-- ── Acesso do responsável ao portal ───────────────────────────────────────
-- As sessões são apagadas quando expiram, então elas não servem de histórico. A
-- tela de acompanhamento precisa saber quem já ENTROU no formulário mas ainda
-- não confirmou o parcelamento ("Em andamento"), e é esta linha — uma por
-- aluno — que registra isso.
CREATE TABLE IF NOT EXISTS public.rematricula_acessos (
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  primeiro_acesso_em timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso_em timestamptz NOT NULL DEFAULT now(),
  acessos integer NOT NULL DEFAULT 1,
  PRIMARY KEY (unidade, aluno_id)
);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.rematricula_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rematricula_cadastro_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rematricula_acessos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rematricula_config_select ON public.rematricula_config;
CREATE POLICY rematricula_config_select ON public.rematricula_config
  FOR SELECT TO authenticated
  USING (
    public.can_view_module(auth.uid(), 'configuracoes'::public.app_module)
    OR public.can_view_module(auth.uid(), 'rematricula'::public.app_module)
  );

DROP POLICY IF EXISTS rematricula_cadastro_auditoria_select ON public.rematricula_cadastro_auditoria;
CREATE POLICY rematricula_cadastro_auditoria_select ON public.rematricula_cadastro_auditoria
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));

DROP POLICY IF EXISTS rematricula_acessos_select ON public.rematricula_acessos;
CREATE POLICY rematricula_acessos_select ON public.rematricula_acessos
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));

-- A escrita das tabelas é feita por server function (service role): o ano
-- letivo depois de checar can_edit_module('configuracoes'), a efetivação depois
-- de can_edit_module('rematricula') e a auditoria pelo próprio portal público.

-- A escolha do parcelamento passa a ser lida pelo módulo Rematrícula (antes só
-- 'admissoes', quando a tela interna ainda não existia).
DROP POLICY IF EXISTS rematricula_escolhas_select ON public.rematricula_escolhas;
CREATE POLICY rematricula_escolhas_select ON public.rematricula_escolhas
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));
