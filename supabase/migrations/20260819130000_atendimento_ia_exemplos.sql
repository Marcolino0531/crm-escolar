-- Biblioteca de exemplos de treinamento (few-shot) do assistente do Atendimento.
--
-- Um exemplo é o par "sugestão da IA" → "resposta que a escola realmente enviou",
-- salvo por decisão explícita do operador (nunca automaticamente). Em cada nova
-- sugestão, alguns exemplos parecidos com a situação atual entram no contexto.
--
-- Diferença em relação a ai_atendimento_settings: lá ficam as REGRAS gerais
-- (system prompt editável); aqui ficam os CASOS REAIS usados como referência.
--
-- RLS: leitura exige can_view_module('financeiro_atendimento_ia'); a escrita é
-- feita por server function (service role) depois de validar a permissão de
-- edição, então não há policy de INSERT/UPDATE/DELETE para o cliente.

CREATE TABLE IF NOT EXISTS public.ai_training_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sugestão de origem, quando houve uma. ON DELETE SET NULL: apagar o log de
  -- sugestões não pode apagar a biblioteca.
  suggestion_id uuid REFERENCES public.ai_suggestions (id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.whatsapp_conversations (id) ON DELETE SET NULL,
  -- AlunoID do Sponte (externo; sem FK local).
  aluno_id text,
  unidade text NOT NULL DEFAULT '',
  -- Situação classificada no momento em que o exemplo foi salvo; é a chave da
  -- seleção de exemplos parecidos.
  situacao text NOT NULL DEFAULT 'outro',
  -- Resumo da conversa até aquele ponto (o histórico não é duplicado).
  contexto text NOT NULL DEFAULT '',
  -- Vazio quando a resposta foi escrita do zero, sem sugestão da IA.
  sugestao_original text NOT NULL DEFAULT '',
  resposta_final text NOT NULL,
  -- Desativar preserva o histórico sem alimentar mais o prompt.
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  criado_por_nome text NOT NULL DEFAULT '',
  atualizado_em timestamptz,
  atualizado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

-- Seleção dos candidatos: por situação, do mais recente para o mais antigo.
CREATE INDEX IF NOT EXISTS ai_training_examples_situacao_idx
  ON public.ai_training_examples (situacao, criado_em DESC)
  WHERE ativo;
CREATE INDEX IF NOT EXISTS ai_training_examples_criado_em_idx
  ON public.ai_training_examples (criado_em DESC);
-- Evita salvar o mesmo par duas vezes por clique repetido no botão.
CREATE UNIQUE INDEX IF NOT EXISTS ai_training_examples_suggestion_uidx
  ON public.ai_training_examples (suggestion_id)
  WHERE suggestion_id IS NOT NULL;

ALTER TABLE public.ai_training_examples ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_training_examples'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ai_training_examples', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "atendimento ia view ai_training_examples"
  ON public.ai_training_examples FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'financeiro_atendimento_ia'::public.app_module));

NOTIFY pgrst, 'reload schema';
