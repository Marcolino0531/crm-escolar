-- Módulo "Uniformes" — suporte a múltiplas lojas Nuvemshop (multiloja por unidade).
--
-- Cada loja Nuvemshop atende um conjunto de unidades (schools):
--   • store_key 'belvedere' → "Núcleo Belvedere" + "Núcleo Vale do Sereno"
--   • store_key 'cec'       → "CEC" + "CEC Baby"
--
-- O catálogo passa a ser identificado por (store_key, ns_product_id) e
-- (store_key, ns_variant_id), pois os IDs da Nuvemshop são únicos apenas dentro
-- de cada loja (podem colidir entre lojas distintas). Linhas pré-existentes
-- (loja uniformesnb) são marcadas como 'belvedere'.

-- ─── Coluna store_key ────────────────────────────────────────────────────────
ALTER TABLE public.uniform_products
  ADD COLUMN IF NOT EXISTS store_key text NOT NULL DEFAULT 'belvedere';
ALTER TABLE public.uniform_variants
  ADD COLUMN IF NOT EXISTS store_key text NOT NULL DEFAULT 'belvedere';

-- ─── Unicidade composta + FK composta ────────────────────────────────────────
-- Remove a FK antiga (variants → products) antes de mexer na unicidade que ela usa.
ALTER TABLE public.uniform_variants
  DROP CONSTRAINT IF EXISTS uniform_variants_ns_product_id_fkey;

-- Produtos: troca UNIQUE(ns_product_id) por UNIQUE(store_key, ns_product_id).
ALTER TABLE public.uniform_products
  DROP CONSTRAINT IF EXISTS uniform_products_ns_product_id_key;
ALTER TABLE public.uniform_products
  ADD CONSTRAINT uniform_products_store_product_key UNIQUE (store_key, ns_product_id);

-- Variações: troca UNIQUE(ns_variant_id) por UNIQUE(store_key, ns_variant_id).
ALTER TABLE public.uniform_variants
  DROP CONSTRAINT IF EXISTS uniform_variants_ns_variant_id_key;
ALTER TABLE public.uniform_variants
  ADD CONSTRAINT uniform_variants_store_variant_key UNIQUE (store_key, ns_variant_id);

-- Recria a FK composta (variants → products) sobre a nova unicidade.
ALTER TABLE public.uniform_variants
  ADD CONSTRAINT uniform_variants_store_product_fkey
  FOREIGN KEY (store_key, ns_product_id)
  REFERENCES public.uniform_products (store_key, ns_product_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS uniform_variants_store_idx
  ON public.uniform_variants (store_key);
