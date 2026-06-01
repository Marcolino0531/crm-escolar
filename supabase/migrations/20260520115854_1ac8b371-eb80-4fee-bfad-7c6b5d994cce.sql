
CREATE TABLE public.cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.categorization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL,
  cost_center_id UUID NOT NULL REFERENCES public.cost_centers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rules_keyword ON public.categorization_rules (lower(keyword));

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('entrada','saida')),
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_date ON public.transactions (date DESC);

ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorization_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- App interno sem autenticação: acesso público (anon) leitura/escrita
CREATE POLICY "public all cc" ON public.cost_centers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all rules" ON public.categorization_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all tx" ON public.transactions FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.cost_centers (name, color) VALUES
  ('Pessoal', '#3b82f6'),
  ('Tributário', '#0ea5e9'),
  ('Obras de Manutenção', '#06b6d4'),
  ('Cozinha', '#6366f1');
