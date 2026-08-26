-- Pausa temporária ("comprovante recebido") do disparo automático de WhatsApp.
--
-- O responsável manda o comprovante pelo Atendimento, mas a baixa no Sponte só
-- entra quando o arquivo retorno do banco é processado. Enquanto isso, o cron
-- das 09:00 cobraria de novo algo já pago. Cada linha aqui suspende os disparos
-- (cobrança de inadimplência E lembrete de vencimento) de um responsável até
-- `expira_em` (24h a partir do clique).
--
-- Não confundir com whatsapp_billing_pause (kill switch do dia, para todos).
--
-- Escopo: aluno_id NULL pausa todas as parcelas do telefone; preenchido pausa só
-- as daquele aluno, para o irmão em aberto continuar sendo cobrado.
--
-- A retomada é derivada do tempo (expira_em > now()); não há job de expiração.
-- Cancelar antes do prazo = apagar a linha. Nada é escrito no Sponte.

CREATE TABLE IF NOT EXISTS public.whatsapp_billing_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Telefone do responsável como está na conversa (o filtro casa pelos últimos
  -- 8 dígitos, imune a DDI/9º dígito/formatação).
  telefone text NOT NULL,
  aluno_id text,
  aluno_nome text NOT NULL DEFAULT '',
  responsavel_nome text NOT NULL DEFAULT '',
  unidade text NOT NULL DEFAULT '',
  conversation_id uuid REFERENCES public.whatsapp_conversations (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- Nome de quem pausou, capturado no ato (não há tabela de perfis para join).
  created_by_nome text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS whatsapp_billing_pauses_expira_idx
  ON public.whatsapp_billing_pauses (expira_em DESC);

ALTER TABLE public.whatsapp_billing_pauses ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_billing_pauses'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_billing_pauses', pol.policyname);
  END LOOP;
END $$;

-- Quem atende no WhatsApp é quem recebe o comprovante, então a permissão de
-- Atendimento cria e cancela a pausa; a de Cobrança também, para o painel de
-- Mensagens Automáticas.
CREATE POLICY "view whatsapp_billing_pauses"
  ON public.whatsapp_billing_pauses
  FOR SELECT TO authenticated
  USING (
    public.can_view_module(auth.uid(), 'financeiro_atendimento'::public.app_module)
    OR public.can_view_module(auth.uid(), 'financeiro_cobranca'::public.app_module)
  );

CREATE POLICY "insert whatsapp_billing_pauses"
  ON public.whatsapp_billing_pauses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_edit_module(auth.uid(), 'financeiro_atendimento'::public.app_module)
    OR public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module)
  );

CREATE POLICY "delete whatsapp_billing_pauses"
  ON public.whatsapp_billing_pauses
  FOR DELETE TO authenticated
  USING (
    public.can_edit_module(auth.uid(), 'financeiro_atendimento'::public.app_module)
    OR public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module)
  );

NOTIFY pgrst, 'reload schema';
