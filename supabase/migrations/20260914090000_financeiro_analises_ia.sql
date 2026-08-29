-- Auditoria das Análises com IA do Financeiro.
--
-- Uma linha por pergunta: quem perguntou, quando, a pergunta original, quais
-- consultas da lista FECHADA foram disparadas e com quais argumentos já
-- validados. NÃO guarda chave de API, token, nem a resposta/resultados
-- financeiros detalhados — o objetivo é auditar acesso, não duplicar o dado.
--
-- RLS: leitura só para quem vê o módulo Financeiro (mesma permissão da aba). A
-- escrita é feita pela server function (service role), depois de validar a
-- permissão, então não existe policy de INSERT para o cliente.

CREATE TABLE IF NOT EXISTS public.ai_financeiro_analises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  pergunta text NOT NULL DEFAULT '',
  -- Nomes das ferramentas fechadas disparadas, na ordem.
  ferramentas text[] NOT NULL DEFAULT '{}',
  -- Argumentos sanitizados (já passados pelos schemas), sem dado cadastral.
  argumentos jsonb NOT NULL DEFAULT '[]'::jsonb,
  sucesso boolean NOT NULL DEFAULT false,
  erro text,
  modelo text NOT NULL DEFAULT '',
  tokens_entrada integer NOT NULL DEFAULT 0,
  tokens_saida integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ai_financeiro_analises_criado_em_idx
  ON public.ai_financeiro_analises (criado_em DESC);
CREATE INDEX IF NOT EXISTS ai_financeiro_analises_user_idx
  ON public.ai_financeiro_analises (user_id, criado_em DESC);

ALTER TABLE public.ai_financeiro_analises ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_financeiro_analises'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ai_financeiro_analises', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "analises ia financeiro view" ON public.ai_financeiro_analises
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'financeiro'::public.app_module));

NOTIFY pgrst, 'reload schema';
