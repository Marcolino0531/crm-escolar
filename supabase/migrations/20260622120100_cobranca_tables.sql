-- Módulo "Cobrança" — estruturas de dados.
--
-- 1) cobranca_checklist: status do checklist operacional do mês (checkbox manual
--    "Boletos de Mensalidade Enviados"). Um registro por competência (mês).
-- 2) cobranca_envios: histórico da régua de cobrança automática (D+2, D+4, …) e
--    da geração da notificação extrajudicial (canal = 'extrajudicial'). Permite
--    montar a linha do tempo de "enviado x pendente" em cada perfil.
--
-- RLS: leitura exige can_view_module('cobranca'); escrita exige
-- can_edit_module('cobranca'). Admin sempre passa (has_role). Como ninguém tem
-- a permissão por padrão, o módulo é fail-closed.

-- ─── Checklist operacional do mês ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranca_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Primeiro dia do mês de competência (YYYY-MM-01).
  competencia date NOT NULL,
  boletos_enviados boolean NOT NULL DEFAULT false,
  marcado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  marcado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competencia)
);

DROP TRIGGER IF EXISTS cobranca_checklist_set_updated_at ON public.cobranca_checklist;
CREATE TRIGGER cobranca_checklist_set_updated_at BEFORE UPDATE ON public.cobranca_checklist
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.cobranca_checklist ENABLE ROW LEVEL SECURITY;

-- ─── Histórico de envios da régua / extrajudicial ────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranca_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificador estável do perfil de cobrança (unidade::responsável).
  perfil_key text NOT NULL,
  aluno_id text,
  responsavel_nome text,
  -- Mês de referência do boleto mais atrasado do perfil (YYYY-MM-01).
  competencia date NOT NULL,
  -- Dia do ciclo (2, 4, 6, …, 30). Para a régua regular; 30 = gatilho jurídico.
  tick_dia integer NOT NULL,
  -- 'regua' (mensagem regular) ou 'extrajudicial' (notificação pré-judicial).
  canal text NOT NULL DEFAULT 'regua',
  observacao text,
  enviado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (perfil_key, competencia, tick_dia, canal)
);

CREATE INDEX IF NOT EXISTS cobranca_envios_perfil_idx
  ON public.cobranca_envios (perfil_key, competencia);

ALTER TABLE public.cobranca_envios ENABLE ROW LEVEL SECURITY;

-- ─── Policies (idempotentes) ─────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY['cobranca_checklist', 'cobranca_envios'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "cobranca view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''cobranca''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "cobranca insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), ''cobranca''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "cobranca update %s" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), ''cobranca''::public.app_module)) WITH CHECK (public.can_edit_module(auth.uid(), ''cobranca''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "cobranca delete %s" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), ''cobranca''::public.app_module))',
      t, t);
  END LOOP;
END $$;
