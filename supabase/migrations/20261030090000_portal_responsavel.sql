-- Portal do Responsável: login por LINK MÁGICO por email a partir do CPF do
-- responsável (GetResponsaveis do Sponte), com sessão MULTI-ALUNO.
--
-- Mesmo desenho de segurança de rematricula_links / rematricula_link_pedidos:
--  • CPF nunca é persistido — só o SHA-256 (namespace próprio "portal:").
--  • Token do link e da sessão entram só como hash.
--  • Link de uso único (`usado_em`), 3 pedidos por CPF por hora.
--  • Nenhuma policy para `anon`/`authenticated`: o portal fala só com server
--    functions (service role).
--
-- A diferença: a sessão guarda uma LISTA de alunos [{ unidade, alunoId }], já
-- que um responsável pode ter filhos em unidades diferentes (credenciais Sponte
-- diferentes).

CREATE TABLE IF NOT EXISTS public.portal_link_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf_hash text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_link_pedidos_cpf_idx
  ON public.portal_link_pedidos (cpf_hash, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.portal_links (
  token_hash text PRIMARY KEY,
  cpf_hash text NOT NULL,
  -- Alunos ATIVOS no ano vigente resolvidos no momento do envio:
  -- [{ "unidade": "CEC", "alunoId": "123", "nome": "..." }, ...]
  alunos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ano_letivo integer NOT NULL,
  responsavel_nome text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz
);
CREATE INDEX IF NOT EXISTS portal_links_expira_idx ON public.portal_links (expira_em);

CREATE TABLE IF NOT EXISTS public.portal_sessoes (
  token_hash text PRIMARY KEY,
  cpf_hash text NOT NULL,
  alunos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ano_letivo integer NOT NULL,
  responsavel_nome text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS portal_sessoes_expira_idx ON public.portal_sessoes (expira_em);

ALTER TABLE public.portal_link_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_sessoes ENABLE ROW LEVEL SECURITY;

-- Documentos gerados pelo próprio responsável no portal também vão para
-- documentos_recibos (mesma numeração do Histórico da tela Documentos), com
-- created_by_nome = 'Portal do Responsável'. Nada a alterar no esquema.

NOTIFY pgrst, 'reload schema';
