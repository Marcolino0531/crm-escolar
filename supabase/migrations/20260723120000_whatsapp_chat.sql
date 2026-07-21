-- Módulo "Atendimento" — chat bidirecional de WhatsApp (Cloud API da Meta).
--
-- Quando um responsável responde a um template de cobrança (ou inicia uma
-- conversa), a Meta entrega o evento no webhook `messages`; o backend grava a
-- mensagem recebida e a equipe responde por texto livre (endpoint padrão de
-- mensagens). As conversas ficam salvas e vinculadas ao cadastro do aluno
-- (AlunoID do Sponte), resolvido a partir do telefone via whatsapp_billing_logs.
--
-- RLS: espelha o módulo Cobrança — leitura exige can_view_module('cobranca');
-- escrita exige can_edit_module('cobranca'). Admin sempre passa. Fail-closed.

-- ─── Conversas (uma por telefone) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Telefone do contato em E.164 só-dígitos (ex.: '5531993034128'). Chave natural.
  wa_phone text NOT NULL UNIQUE,
  -- Nome do perfil no WhatsApp (profile.name enviado pela Meta).
  contact_name text NOT NULL DEFAULT '',
  -- Vínculo com o cadastro do aluno (Sponte é externo; sem FK local).
  aluno_id text,
  aluno_name text NOT NULL DEFAULT '',
  responsavel_name text NOT NULL DEFAULT '',
  unidade text NOT NULL DEFAULT '',
  last_message_at timestamptz,
  last_message_preview text NOT NULL DEFAULT '',
  last_message_direction text NOT NULL DEFAULT 'in' CHECK (last_message_direction IN ('in', 'out')),
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_conversations_last_msg_idx
  ON public.whatsapp_conversations (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS whatsapp_conversations_aluno_idx
  ON public.whatsapp_conversations (aluno_id);

DROP TRIGGER IF EXISTS whatsapp_conversations_set_updated_at ON public.whatsapp_conversations;
CREATE TRIGGER whatsapp_conversations_set_updated_at BEFORE UPDATE ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Mensagens (in/out) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations (id) ON DELETE CASCADE,
  -- wamid da Meta (recebida ou enviada). Usado para casar os eventos de status.
  wa_message_id text,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  body text NOT NULL DEFAULT '',
  -- Recebidas: 'recebido'. Enviadas: enviado/entregue/lido/falha (via webhook).
  status text NOT NULL DEFAULT 'recebido'
    CHECK (status IN ('recebido', 'enviado', 'entregue', 'lido', 'falha')),
  erro_mensagem text,
  -- Momento informado pela Meta (timestamp do evento) quando disponível.
  wa_timestamp timestamptz,
  -- Autor do envio (equipe), nas mensagens 'out'.
  enviado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_conversation_idx
  ON public.whatsapp_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS whatsapp_messages_wamid_idx
  ON public.whatsapp_messages (wa_message_id);

-- ─── RLS (idempotente; espelha o módulo Cobrança) ────────────────────────────
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['whatsapp_conversations', 'whatsapp_messages']
  LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "cobranca view %1$s" ON public.%1$s FOR SELECT TO authenticated '
      || 'USING (public.can_view_module(auth.uid(), ''cobranca''::public.app_module))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "cobranca insert %1$s" ON public.%1$s FOR INSERT TO authenticated '
      || 'WITH CHECK (public.can_edit_module(auth.uid(), ''cobranca''::public.app_module))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "cobranca update %1$s" ON public.%1$s FOR UPDATE TO authenticated '
      || 'USING (public.can_edit_module(auth.uid(), ''cobranca''::public.app_module)) '
      || 'WITH CHECK (public.can_edit_module(auth.uid(), ''cobranca''::public.app_module))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "cobranca delete %1$s" ON public.%1$s FOR DELETE TO authenticated '
      || 'USING (public.can_edit_module(auth.uid(), ''cobranca''::public.app_module))',
      tbl
    );
  END LOOP;
END $$;

-- ─── Realtime: publica as tabelas para o postgres_changes do Supabase ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'whatsapp_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
