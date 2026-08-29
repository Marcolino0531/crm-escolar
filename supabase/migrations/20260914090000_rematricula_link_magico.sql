-- Rematrícula: autenticação por LINK MÁGICO por email (Resend) no lugar do
-- código de 6 dígitos por WhatsApp.
--
-- A Meta não liberou o template de categoria Authentication na conta do
-- WhatsApp Business, então o portal público passa a mandar um link de uso único
-- para o email do responsável financeiro cadastrado no Sponte. O WhatsApp segue
-- em uso normal na cobrança — só este fluxo de login muda.
--
-- PRIVACIDADE / SEGURANÇA
--  • O CPF continua fora do banco: só o SHA-256 dele é gravado.
--  • O token do link também entra apenas como hash — um dump da tabela não
--    permite entrar no portal de ninguém.
--  • Nenhuma das tabelas tem policy para `anon` nem para `authenticated`: o
--    portal fala só com server functions (service role).

-- ── Links mágicos emitidos ────────────────────────────────────────────────
-- Uma linha por link. O login queima o link (`usado_em`), então reabrir a URL
-- do email não dá acesso de novo.
CREATE TABLE IF NOT EXISTS public.rematricula_links (
  token_hash text PRIMARY KEY,
  cpf_hash text NOT NULL,
  -- Aluno resolvido no Sponte no momento do envio: a sessão nasce dele, e não
  -- de nada que o navegador informe depois.
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz
);

CREATE INDEX IF NOT EXISTS rematricula_links_expira_idx
  ON public.rematricula_links (expira_em);

CREATE INDEX IF NOT EXISTS rematricula_links_cpf_idx
  ON public.rematricula_links (cpf_hash, criado_em DESC);

ALTER TABLE public.rematricula_links ENABLE ROW LEVEL SECURITY;

-- ── Registro de solicitações (rate limit) ─────────────────────────────────
-- Toda solicitação entra aqui, inclusive as de CPF sem aluno correspondente:
-- assim o limite de 3 por hora não vaza a informação de quais CPFs existem.
CREATE TABLE IF NOT EXISTS public.rematricula_link_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf_hash text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rematricula_link_pedidos_cpf_idx
  ON public.rematricula_link_pedidos (cpf_hash, criado_em DESC);

ALTER TABLE public.rematricula_link_pedidos ENABLE ROW LEVEL SECURITY;

-- ── Fim do desafio por código no WhatsApp ─────────────────────────────────
-- A tabela só guardava desafios transitórios (hash de código, tentativas), sem
-- nenhum dado histórico: sai junto com o fluxo que a criou.
DROP TABLE IF EXISTS public.rematricula_codigos;
