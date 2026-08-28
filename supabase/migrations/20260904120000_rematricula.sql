-- Portal público de Rematrícula.
--
-- O responsável entra num portal PÚBLICO informando apenas o CPF do aluno,
-- recebe um código de 6 dígitos por WhatsApp (template de categoria
-- Authentication) e, com o código válido, ganha uma SESSÃO TEMPORÁRIA para
-- revisar os dados do aluno e escolher o parcelamento do material pedagógico.
--
-- PRIVACIDADE / SEGURANÇA
--  • O CPF nunca é gravado: as tabelas guardam apenas o SHA-256 dele, que basta
--    para achar o desafio em aberto e contar tentativas.
--  • O código e o token de sessão também entram apenas como hash — um dump da
--    tabela não permite entrar no portal de ninguém.
--  • Nenhuma destas tabelas tem policy para `anon`: o portal fala só com server
--    functions (service role). O contador de tentativas e as sessões não têm
--    policy nenhuma, nem para `authenticated`.
--
-- NADA é lançado no Sponte por este fluxo: a escolha de parcelamento fica
-- registrada como PENDENTE DE LANÇAMENTO (rematricula_escolhas.status).

-- ── Valor anual do material pedagógico por unidade × série ────────────────
-- Cadastro administrativo (Configurações → "Material Pedagógico por Série").
-- `serie_chave` é a série normalizada (sem acento, minúscula, espaços
-- colapsados) e é ela que garante a unicidade e casa com a série do aluno
-- lida do Sponte; `serie` preserva o rótulo como o administrador digitou.
CREATE TABLE IF NOT EXISTS public.material_pedagogico_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  serie text NOT NULL,
  serie_chave text NOT NULL,
  valor_anual numeric(12, 2) NOT NULL CHECK (valor_anual > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS material_pedagogico_series_unica_idx
  ON public.material_pedagogico_series (unidade, serie_chave);

-- ── Desafio de autenticação (código de 6 dígitos) ─────────────────────────
-- Uma linha por CPF (hash): pedir um novo código substitui o anterior.
CREATE TABLE IF NOT EXISTS public.rematricula_codigos (
  cpf_hash text PRIMARY KEY,
  codigo_hash text NOT NULL DEFAULT '',
  expira_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  -- Aluno resolvido no Sponte no momento do envio: a sessão nasce dele, e não
  -- de nada que o navegador informe depois.
  unidade text NOT NULL DEFAULT '',
  aluno_id text NOT NULL DEFAULT '',
  enviado_em timestamptz,
  consumido_em timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Sessões temporárias do portal ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rematricula_sessoes (
  token_hash text PRIMARY KEY,
  cpf_hash text NOT NULL,
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS rematricula_sessoes_expira_idx
  ON public.rematricula_sessoes (expira_em);

-- ── Escolha de parcelamento do material (pendente de lançamento) ──────────
CREATE TABLE IF NOT EXISTS public.rematricula_escolhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  serie text NOT NULL DEFAULT '',
  serie_chave text NOT NULL DEFAULT '',
  valor_anual numeric(12, 2) NOT NULL CHECK (valor_anual > 0),
  parcelas integer NOT NULL CHECK (parcelas BETWEEN 1 AND 8),
  valor_parcela numeric(12, 2) NOT NULL CHECK (valor_parcela > 0),
  valor_ultima_parcela numeric(12, 2) NOT NULL CHECK (valor_ultima_parcela > 0),
  -- Só existe 'pendente_lancamento' nesta fase: nenhum título é criado no
  -- Sponte pelo portal.
  status text NOT NULL DEFAULT 'pendente_lancamento'
    CHECK (status IN ('pendente_lancamento')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Uma escolha vigente por aluno/unidade: trocar o parcelamento atualiza a linha.
CREATE UNIQUE INDEX IF NOT EXISTS rematricula_escolhas_aluno_idx
  ON public.rematricula_escolhas (unidade, aluno_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.material_pedagogico_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rematricula_codigos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rematricula_sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rematricula_escolhas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_pedagogico_series_select ON public.material_pedagogico_series;
CREATE POLICY material_pedagogico_series_select ON public.material_pedagogico_series
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'configuracoes'::public.app_module));

DROP POLICY IF EXISTS rematricula_escolhas_select ON public.rematricula_escolhas;
CREATE POLICY rematricula_escolhas_select ON public.rematricula_escolhas
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'admissoes'::public.app_module));

-- A escrita do cadastro de material é feita por server function (service role)
-- depois de checar can_edit_module('configuracoes'); as escolhas nascem apenas
-- no portal público (service role). rematricula_codigos e rematricula_sessoes
-- ficam sem policy alguma: só a service role as enxerga.
