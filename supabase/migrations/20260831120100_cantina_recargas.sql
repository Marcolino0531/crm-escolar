-- Portal de recarga do cartão da cantina.
--
-- O pai entra num portal PÚBLICO (fora do app interno) com o CPF do aluno como
-- usuário e senha, informa o valor e a solicitação cai aqui como 'pendente'. A
-- equipe acompanha no módulo interno Cantina, carrega o cartão fisicamente e
-- marca "Recarga efetivada".
--
-- NADA é escrito no Sponte por este fluxo: não existe método na API para
-- acrescentar um item a um boleto de mensalidade já emitido (só InsertPlano, que
-- cria um título novo). Por isso o valor a incluir no próximo boleto é apenas
-- INDICADO na tela (boleto_* abaixo, gravados no momento da efetivação) e a
-- passagem para 'lancada_no_boleto' é uma confirmação MANUAL de quem lançou.
--
-- PRIVACIDADE: o portal autentica por CPF, mas o CPF do aluno não é gravado
-- aqui — a solicitação guarda o AlunoID do Sponte e o nome. As tentativas de
-- login guardam apenas um HASH do CPF (SHA-256), suficiente para contar falhas
-- por CPF sem armazenar o dado em claro.

-- ── Solicitações de recarga ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cantina_recargas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  -- Aluno identificado no Sponte durante o login público.
  aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  aluno_turma text NOT NULL DEFAULT '',
  -- Responsáveis vinculados ao aluno no Sponte no momento da solicitação
  -- (apenas nome/parentesco, para a equipe saber com quem falar).
  responsaveis jsonb NOT NULL DEFAULT '[]'::jsonb,
  valor numeric(12, 2) NOT NULL CHECK (valor > 0),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'efetivada', 'lancada_no_boleto')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Efetivação (recarga física do cartão) — quem e quando.
  efetivada_at timestamptz,
  efetivada_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  efetivada_por_nome text NOT NULL DEFAULT '',
  -- Indicação do próximo boleto em aberto do aluno, consultada no Sponte na
  -- efetivação. É o boleto em que a equipe deve incluir o valor manualmente.
  boleto_conta_receber_id text NOT NULL DEFAULT '',
  boleto_numero text NOT NULL DEFAULT '',
  boleto_vencimento date,
  -- Sem próximo boleto em aberto encontrado (só parcelas vencidas/quitadas).
  boleto_indisponivel boolean NOT NULL DEFAULT false,
  -- Confirmação MANUAL de que o valor foi lançado no boleto.
  lancada_at timestamptz,
  lancada_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  lancada_por_nome text NOT NULL DEFAULT '',
  observacao text NOT NULL DEFAULT '',
  -- Histórico das transições: [{ "status": "efetivada", "at": "...", "por": "..." }].
  historico jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS cantina_recargas_status_idx
  ON public.cantina_recargas (status, created_at DESC);
CREATE INDEX IF NOT EXISTS cantina_recargas_unidade_idx
  ON public.cantina_recargas (unidade, created_at DESC);
CREATE INDEX IF NOT EXISTS cantina_recargas_aluno_idx
  ON public.cantina_recargas (aluno_id);

-- ── Tentativas de login do portal (trava de força bruta) ──────────────────
-- Uma linha por CPF (hash). Persistido no banco de propósito: as funções da
-- Vercel são serverless e multi-instância, então um contador em memória não
-- travaria nada.
CREATE TABLE IF NOT EXISTS public.cantina_login_attempts (
  cpf_hash text PRIMARY KEY,
  falhas integer NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  ultima_falha_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cantina_login_attempts_bloqueio_idx
  ON public.cantina_login_attempts (bloqueado_ate);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- O portal público NÃO fala com estas tabelas pelo cliente: ele chama server
-- functions que usam a service role. Logo, nenhuma policy para anon.
ALTER TABLE public.cantina_recargas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cantina_login_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cantina recargas select" ON public.cantina_recargas;
DROP POLICY IF EXISTS "cantina recargas update" ON public.cantina_recargas;

CREATE POLICY "cantina recargas select" ON public.cantina_recargas
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'cantina'::public.app_module));

CREATE POLICY "cantina recargas update" ON public.cantina_recargas
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'cantina'::public.app_module))
  WITH CHECK (public.can_edit_module(auth.uid(), 'cantina'::public.app_module));

-- Solicitação é registro do que o responsável pediu: nasce só pelo portal
-- (service role) e não se apaga. Sem policy de INSERT nem de DELETE.
-- cantina_login_attempts fica sem nenhuma policy: acesso apenas via service
-- role, para que o contador de falhas não seja legível nem editável pelo app.
