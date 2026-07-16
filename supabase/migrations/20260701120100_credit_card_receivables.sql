-- Controle de Recebíveis (Cartão de Crédito) — estrutura de dados.
--
-- public.credit_card_receivables: cada linha é um pagamento no cartão feito por
-- um responsável, com a data em que o crédito será liberado pela operadora e os
-- valores bruto/líquido (já com a taxa da maquininha descontada).
--
-- status:
--   • 'aguardando'  — crédito ainda não liberado pela operadora.
--   • 'disponivel'  — data_disponibilidade chegou; falta transferir para a conta.
--   • 'transferido' — valor já transferido para a conta do colégio.
-- A transição aguardando → disponivel acontece automaticamente (Vercel Cron
-- diário em /api/receivables/cron) quando data_disponibilidade <= hoje.
--
-- RLS (fail-closed): leitura exige can_view_module('financeiro_cartao'); escrita
-- exige can_edit_module('financeiro_cartao'). Admin sempre passa (has_role).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_card_status') THEN
    CREATE TYPE public.credit_card_status AS ENUM ('aguardando', 'disponivel', 'transferido');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.credit_card_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Data em que o responsável passou o cartão.
  data_pagamento date NOT NULL,
  -- Data em que o crédito será liberado pela operadora.
  data_disponibilidade date NOT NULL,
  -- Valor total pago.
  valor_bruto numeric(12, 2) NOT NULL,
  -- Valor já com o desconto da taxa da maquininha.
  valor_liquido numeric(12, 2) NOT NULL,
  status public.credit_card_status NOT NULL DEFAULT 'aguardando',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_card_receivables_status_disp_idx
  ON public.credit_card_receivables (status, data_disponibilidade);

DROP TRIGGER IF EXISTS credit_card_receivables_set_updated_at ON public.credit_card_receivables;
CREATE TRIGGER credit_card_receivables_set_updated_at
  BEFORE UPDATE ON public.credit_card_receivables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.credit_card_receivables ENABLE ROW LEVEL SECURITY;

-- ─── Policies (idempotentes) ─────────────────────────────────────────────────
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'credit_card_receivables'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.credit_card_receivables', pol.policyname);
  END LOOP;

  CREATE POLICY "cartao view" ON public.credit_card_receivables
    FOR SELECT TO authenticated
    USING (public.can_view_module(auth.uid(), 'financeiro_cartao'::public.app_module));
  CREATE POLICY "cartao insert" ON public.credit_card_receivables
    FOR INSERT TO authenticated
    WITH CHECK (public.can_edit_module(auth.uid(), 'financeiro_cartao'::public.app_module));
  CREATE POLICY "cartao update" ON public.credit_card_receivables
    FOR UPDATE TO authenticated
    USING (public.can_edit_module(auth.uid(), 'financeiro_cartao'::public.app_module))
    WITH CHECK (public.can_edit_module(auth.uid(), 'financeiro_cartao'::public.app_module));
  CREATE POLICY "cartao delete" ON public.credit_card_receivables
    FOR DELETE TO authenticated
    USING (public.can_edit_module(auth.uid(), 'financeiro_cartao'::public.app_module));
END $$;
