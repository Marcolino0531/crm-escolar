-- Salário líquido por competência, ao lado do bruto (`valor`).
ALTER TABLE public.funcionarios_salarios
  ADD COLUMN IF NOT EXISTS valor_liquido numeric(12, 2)
    CHECK (valor_liquido IS NULL OR valor_liquido >= 0);

COMMENT ON COLUMN public.funcionarios_salarios.valor IS 'Salário bruto da competência.';
COMMENT ON COLUMN public.funcionarios_salarios.valor_liquido IS 'Salário líquido da competência (opcional).';
