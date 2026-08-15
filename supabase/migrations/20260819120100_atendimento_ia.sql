-- Assistente de IA do Atendimento — MODO TREINAMENTO (a IA só sugere).
--
-- Duas tabelas:
--   ai_atendimento_settings  instruções editáveis na tela (system prompt), linha única
--   ai_suggestions           registro de cada sugestão gerada e, quando houve
--                            envio a partir dela, a versão final realmente enviada
--
-- O par sugestão/versão-final é a matéria-prima da biblioteca de exemplos de
-- treinamento: `editado` marca os casos em que o texto foi ajustado à mão.
--
-- RLS: leitura exige can_view_module('financeiro_atendimento_ia'); a escrita é
-- feita por server function (service role) depois de validar a permissão de
-- edição, então não há policy de INSERT/UPDATE para o cliente. Admin sempre passa.

-- ─── Instruções da IA (linha única) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_atendimento_settings (
  -- Linha única garantida pelo CHECK: o prompt é global, não por usuário.
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  system_prompt text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

-- ─── Sugestões geradas ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations (id) ON DELETE CASCADE,
  -- AlunoID do Sponte (externo; sem FK local).
  aluno_id text,
  unidade text NOT NULL DEFAULT '',
  -- Classificação por palavra-chave da última mensagem do responsável.
  situacao text NOT NULL DEFAULT 'outro',
  -- Caso sensível: a sugestão é um aviso para responder pessoalmente.
  sensivel boolean NOT NULL DEFAULT false,
  motivo_sensivel text NOT NULL DEFAULT '',
  -- Texto sugerido pela IA (ou o aviso, quando sensível).
  sugestao text NOT NULL DEFAULT '',
  -- Resumo do contexto no momento da geração (o histórico não é duplicado).
  contexto_resumo text NOT NULL DEFAULT '',
  modelo text NOT NULL DEFAULT '',
  -- Uso de tokens: base do acompanhamento de custo.
  tokens_entrada integer NOT NULL DEFAULT 0,
  tokens_saida integer NOT NULL DEFAULT 0,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  gerado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- Preenchidos quando a resposta é enviada a partir desta sugestão.
  enviado_body text,
  enviado_em timestamptz,
  editado boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ai_suggestions_conversation_idx
  ON public.ai_suggestions (conversation_id, gerado_em DESC);
CREATE INDEX IF NOT EXISTS ai_suggestions_gerado_em_idx
  ON public.ai_suggestions (gerado_em DESC);
-- Candidatas a exemplo de treinamento: enviadas com texto ajustado à mão.
CREATE INDEX IF NOT EXISTS ai_suggestions_editadas_idx
  ON public.ai_suggestions (gerado_em DESC)
  WHERE editado;

-- ─── RLS (idempotente; somente leitura pelo cliente) ─────────────────────────
ALTER TABLE public.ai_atendimento_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ai_atendimento_settings', 'ai_suggestions']
  LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "atendimento ia view %1$s" ON public.%1$s FOR SELECT TO authenticated '
      || 'USING (public.can_view_module(auth.uid(), ''financeiro_atendimento_ia''::public.app_module))',
      tbl
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
