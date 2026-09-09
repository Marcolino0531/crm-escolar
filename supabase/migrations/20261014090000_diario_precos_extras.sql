-- Tabela de Preços dos Extras do Diário do Aluno: valor por unidade × categoria
-- × ano letivo. Histórico preservado por ano (nunca sobrescreve o ano anterior).
-- Refeições: preço por ocorrência. Hora Extra: preço por hora (cobrada por fração).

CREATE TABLE IF NOT EXISTS public.diario_precos_extras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  categoria text NOT NULL
    CHECK (categoria IN ('breakfast', 'lunch', 'snack', 'dinner', 'hora_extra')),
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  valor numeric(12, 2) NOT NULL CHECK (valor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS diario_precos_extras_unico_idx
  ON public.diario_precos_extras (unidade, categoria, ano_letivo);

ALTER TABLE public.diario_precos_extras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "diario view diario_precos_extras" ON public.diario_precos_extras;
CREATE POLICY "diario view diario_precos_extras" ON public.diario_precos_extras
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'diario'::public.app_module));
