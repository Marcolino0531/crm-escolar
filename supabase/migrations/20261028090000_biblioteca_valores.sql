-- Valor Biblioteca: multa por dia útil, teto da multa e prazo padrão de
-- devolução por unidade × ano letivo (antes fixos em src/lib/biblioteca.ts).
-- Sem linha para a unidade/ano o cálculo usa os valores padrão.

CREATE TABLE IF NOT EXISTS public.biblioteca_valores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  multa_por_dia_util numeric(12, 2) NOT NULL CHECK (multa_por_dia_util >= 0),
  multa_teto numeric(12, 2) NOT NULL CHECK (multa_teto >= 0),
  prazo_padrao_dias integer NOT NULL CHECK (prazo_padrao_dias BETWEEN 1 AND 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT biblioteca_valores_unico UNIQUE (school_id, ano_letivo)
);

ALTER TABLE public.biblioteca_valores ENABLE ROW LEVEL SECURITY;

-- Escrita só pelas server functions (cliente admin, exige editar 'biblioteca').
DROP POLICY IF EXISTS "biblioteca view biblioteca_valores" ON public.biblioteca_valores;
CREATE POLICY "biblioteca view biblioteca_valores" ON public.biblioteca_valores
  FOR SELECT TO authenticated
  USING (
    public.can_view_module(auth.uid(), 'biblioteca'::public.app_module)
    AND public.can_access_school(auth.uid(), school_id)
  );
