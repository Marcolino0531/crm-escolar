-- Uniformes — marcação "Pedido realizado" por variação (peça/tamanho).
--
-- `uniform_variants.order_placed_at` guarda o momento em que a peça foi
-- solicitada à fábrica (NULL = não pedida). A coluna é preservada pelas
-- sincronizações da Nuvemshop, que só reescrevem catálogo/saldo.
--
-- `uniform_order_marks` mantém o histórico: uma linha por marcação, encerrada
-- (cleared_at) quando o pedido é atendido — automaticamente, quando o saldo
-- volta ao nível mínimo — ou desmarcado à mão. Guardar o saldo no momento da
-- marcação permite auditar depois se o pedido foi de fato entregue.

ALTER TABLE public.uniform_variants
  ADD COLUMN IF NOT EXISTS order_placed_at timestamptz;
ALTER TABLE public.uniform_variants
  ADD COLUMN IF NOT EXISTS order_placed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS uniform_variants_order_placed_idx
  ON public.uniform_variants (order_placed_at)
  WHERE order_placed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.uniform_order_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL,
  ns_variant_id text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  marked_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- Saldo no instante da marcação (referência para conferir o atendimento).
  stock_at_mark integer,
  cleared_at timestamptz,
  -- 'reabastecido' (automático, saldo voltou ao mínimo) ou 'manual'.
  cleared_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uniform_order_marks_variant_idx
  ON public.uniform_order_marks (store_key, ns_variant_id, marked_at DESC);
-- Uma marcação aberta por variação.
CREATE UNIQUE INDEX IF NOT EXISTS uniform_order_marks_abertas_idx
  ON public.uniform_order_marks (store_key, ns_variant_id)
  WHERE cleared_at IS NULL;

ALTER TABLE public.uniform_order_marks ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão das demais tabelas de Uniformes: leitura com can_view_module,
-- escrita com can_edit_module.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'uniform_order_marks'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.uniform_order_marks', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "uniformes view uniform_order_marks" ON public.uniform_order_marks
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'uniformes'::public.app_module));
CREATE POLICY "uniformes insert uniform_order_marks" ON public.uniform_order_marks
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'uniformes'::public.app_module));
CREATE POLICY "uniformes update uniform_order_marks" ON public.uniform_order_marks
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'uniformes'::public.app_module))
  WITH CHECK (public.can_edit_module(auth.uid(), 'uniformes'::public.app_module));
CREATE POLICY "uniformes delete uniform_order_marks" ON public.uniform_order_marks
  FOR DELETE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'uniformes'::public.app_module));
