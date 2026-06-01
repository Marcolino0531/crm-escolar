CREATE TABLE public.boleto_reconciliations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID NOT NULL UNIQUE,
  school_id UUID NOT NULL,
  source_filename TEXT,
  total_amount NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.boleto_reconciliation_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reconciliation_id UUID NOT NULL REFERENCES public.boleto_reconciliations(id) ON DELETE CASCADE,
  revenue_category_id UUID,
  revenue_subcategory_id UUID,
  subcategory_label TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_boleto_recon_tx ON public.boleto_reconciliations(transaction_id);
CREATE INDEX idx_boleto_recon_school_date ON public.boleto_reconciliations(school_id);
CREATE INDEX idx_boleto_recon_items_recon ON public.boleto_reconciliation_items(reconciliation_id);

ALTER TABLE public.boleto_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boleto_reconciliation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all boleto_recon" ON public.boleto_reconciliations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all boleto_recon_items" ON public.boleto_reconciliation_items FOR ALL TO authenticated USING (true) WITH CHECK (true);