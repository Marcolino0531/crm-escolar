-- Módulo "Uniformes" — estruturas de dados (espelho do catálogo Nuvemshop).
--
-- 1) uniform_products: espelho dos produtos da loja (peças de uniforme).
-- 2) uniform_variants: variações/tamanhos de cada produto, com o saldo de
--    estoque (stock) e o limiar de alerta de estoque mínimo (min_stock, default 5).
-- 3) uniform_sync_log: auditoria das execuções de sincronização (cron noturno,
--    webhook em tempo real e sincronização manual).
--
-- A escrita normalmente é feita pela rotina de integração (service role / Edge
-- Function), que ignora o RLS. As policies abaixo cobrem o acesso a partir do
-- app autenticado: leitura exige can_view_module('uniformes'); ajustes manuais
-- (ex.: min_stock) exigem can_edit_module('uniformes'). Admin sempre passa.

-- ─── Produtos (peças) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.uniform_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificador do produto na Nuvemshop (estável).
  ns_product_id text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  category text,
  handle text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS uniform_products_set_updated_at ON public.uniform_products;
CREATE TRIGGER uniform_products_set_updated_at BEFORE UPDATE ON public.uniform_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.uniform_products ENABLE ROW LEVEL SECURITY;

-- ─── Variações (tamanhos) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.uniform_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificador da variação na Nuvemshop (estável).
  ns_variant_id text NOT NULL UNIQUE,
  ns_product_id text NOT NULL REFERENCES public.uniform_products (ns_product_id) ON DELETE CASCADE,
  -- Rótulo do tamanho/variação (ex.: "P", "M", "GG", "10 anos").
  size text NOT NULL DEFAULT '',
  sku text,
  stock integer NOT NULL DEFAULT 0,
  -- Limiar de alerta de estoque mínimo (default 5 unidades).
  min_stock integer NOT NULL DEFAULT 5,
  price numeric(12, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uniform_variants_product_idx
  ON public.uniform_variants (ns_product_id);
CREATE INDEX IF NOT EXISTS uniform_variants_low_stock_idx
  ON public.uniform_variants (stock);

DROP TRIGGER IF EXISTS uniform_variants_set_updated_at ON public.uniform_variants;
CREATE TRIGGER uniform_variants_set_updated_at BEFORE UPDATE ON public.uniform_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.uniform_variants ENABLE ROW LEVEL SECURITY;

-- ─── Log de sincronização (auditoria) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.uniform_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'cron' (madrugada), 'webhook' (tempo real) ou 'manual' (botão na UI).
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'ok',
  products_synced integer NOT NULL DEFAULT 0,
  variants_synced integer NOT NULL DEFAULT 0,
  discrepancies integer NOT NULL DEFAULT 0,
  message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS uniform_sync_log_started_idx
  ON public.uniform_sync_log (started_at DESC);

ALTER TABLE public.uniform_sync_log ENABLE ROW LEVEL SECURITY;

-- ─── Policies (idempotentes) ─────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY['uniform_products', 'uniform_variants', 'uniform_sync_log'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "uniformes view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''uniformes''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "uniformes insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), ''uniformes''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "uniformes update %s" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), ''uniformes''::public.app_module)) WITH CHECK (public.can_edit_module(auth.uid(), ''uniformes''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "uniformes delete %s" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), ''uniformes''::public.app_module))',
      t, t);
  END LOOP;
END $$;
