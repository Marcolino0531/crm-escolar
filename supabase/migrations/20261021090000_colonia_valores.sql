-- Valor Colônia de Férias: valores e regras de cálculo por unidade × ano letivo
-- (antes fixos em src/lib/colonia-billing.ts). Sem linha para a unidade/ano o
-- cálculo usa os valores padrão e avisa.

CREATE TABLE IF NOT EXISTS public.colonia_valores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  diaria_avulsa numeric(12, 2) NOT NULL CHECK (diaria_avulsa >= 0),
  pacote_semanal numeric(12, 2) NOT NULL CHECK (pacote_semanal >= 0),
  hora_extra_por_hora numeric(12, 2) NOT NULL CHECK (hora_extra_por_hora >= 0),
  lanche_por_registro numeric(12, 2) NOT NULL CHECK (lanche_por_registro >= 0),
  refeicao_principal_por_registro numeric(12, 2) NOT NULL
    CHECK (refeicao_principal_por_registro >= 0),
  franquia_minutos integer NOT NULL CHECK (franquia_minutos >= 0),
  dias_para_pacote integer NOT NULL CHECK (dias_para_pacote BETWEEN 1 AND 5),
  meses_credito_isencao integer[] NOT NULL DEFAULT '{7,12}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT colonia_valores_unico UNIQUE (school_id, ano_letivo),
  CONSTRAINT colonia_valores_meses_validos CHECK (
    meses_credito_isencao <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]
  )
);

ALTER TABLE public.colonia_valores ENABLE ROW LEVEL SECURITY;

-- Escrita só pelas server functions (cliente admin, exige colonia_financeiro).
DROP POLICY IF EXISTS "colonia view colonia_valores" ON public.colonia_valores;
CREATE POLICY "colonia view colonia_valores" ON public.colonia_valores
  FOR SELECT TO authenticated
  USING (
    public.can_view_module(auth.uid(), 'colonia'::public.app_module)
    OR public.can_view_module(auth.uid(), 'colonia_financeiro'::public.app_module)
  );
