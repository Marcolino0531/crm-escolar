-- Salário base por funcionário × competência (YYYY-MM), com histórico
-- preservado: cada competência é uma linha própria (nunca sobrescreve a
-- anterior), no mesmo espírito de material_pedagogico_series por ano.
-- O salário vigente numa competência é a linha de maior competência <= ela.
--
-- Acesso SOMENTE pelo módulo dedicado 'rh_salario' (migration anterior): a
-- RLS não libera 'rh' e as server functions checam can_view/can_edit_module
-- com 'rh_salario'.

CREATE TABLE IF NOT EXISTS public.funcionarios_salarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios (id) ON DELETE CASCADE,
  competencia text NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  valor numeric(12, 2) NOT NULL CHECK (valor >= 0),
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funcionario_id, competencia)
);

CREATE INDEX IF NOT EXISTS funcionarios_salarios_funcionario_idx
  ON public.funcionarios_salarios (funcionario_id, competencia DESC);

ALTER TABLE public.funcionarios_salarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rh_salario view funcionarios_salarios" ON public.funcionarios_salarios;
CREATE POLICY "rh_salario view funcionarios_salarios" ON public.funcionarios_salarios
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rh_salario'::public.app_module));

DROP POLICY IF EXISTS "rh_salario edit funcionarios_salarios" ON public.funcionarios_salarios;
CREATE POLICY "rh_salario edit funcionarios_salarios" ON public.funcionarios_salarios
  FOR ALL TO authenticated
  USING (public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module))
  WITH CHECK (public.can_edit_module(auth.uid(), 'rh_salario'::public.app_module));
