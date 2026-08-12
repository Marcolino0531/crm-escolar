-- Cobrança Automática — exceções por ACORDO DE PARCELAMENTO.
--
-- Quando o acordo é fechado direto com o responsável, a automação de WhatsApp
-- não deve mais insistir nas parcelas anteriores ao acordo, mas continua
-- cobrando o que vencer depois dele. A exceção guarda apenas o AlunoID e o mês
-- de referência: NADA é escrito no Sponte nem nos débitos do School Hub, e as
-- parcelas seguem visíveis em Inadimplência, Fluxo Futuro etc.
--
-- Um aluno tem no máximo uma exceção vigente (unique em aluno_id); recadastrar
-- atualiza o mês de referência. Remover a linha devolve o aluno à régua
-- completa, inclusive às parcelas antigas — o filtro é aplicado no disparo, não
-- gravado nas parcelas.

CREATE TABLE IF NOT EXISTS public.whatsapp_billing_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  unidade text NOT NULL,
  -- Mês do acordo (YYYY-MM): parcelas vencidas até o fim dele saem da cobrança.
  mes_referencia text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- Nome de quem cadastrou, capturado no ato (não há tabela de perfis para join).
  created_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT whatsapp_billing_exceptions_aluno_key UNIQUE (aluno_id),
  CONSTRAINT whatsapp_billing_exceptions_mes_chk CHECK (mes_referencia ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

ALTER TABLE public.whatsapp_billing_exceptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_billing_exceptions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_billing_exceptions', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "cobranca view whatsapp_billing_exceptions"
  ON public.whatsapp_billing_exceptions
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'financeiro_cobranca'::public.app_module));

CREATE POLICY "cobranca insert whatsapp_billing_exceptions"
  ON public.whatsapp_billing_exceptions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module));

CREATE POLICY "cobranca update whatsapp_billing_exceptions"
  ON public.whatsapp_billing_exceptions
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module))
  WITH CHECK (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module));

CREATE POLICY "cobranca delete whatsapp_billing_exceptions"
  ON public.whatsapp_billing_exceptions
  FOR DELETE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module));

NOTIFY pgrst, 'reload schema';
