-- Estoque de Material Escolar — tabela única compartilhada entre as quatro
-- unidades (sem coluna de escola: a listagem é a mesma para todos).
--
-- Estrutura simples: material pedagógico (texto livre), turma (texto) e a
-- quantidade (inteiro ≥ 0) daquele material para aquela turma.
--
-- RLS: leitura exige can_view_module('estoque_material'); inserir/editar/excluir
-- exige can_edit_module('estoque_material'). Admin sempre passa.

CREATE TABLE IF NOT EXISTS public.school_material_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material text NOT NULL,
  turma text NOT NULL,
  quantidade integer NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_material_stock_material_idx
  ON public.school_material_stock (material);

DROP TRIGGER IF EXISTS school_material_stock_set_updated_at ON public.school_material_stock;
CREATE TRIGGER school_material_stock_set_updated_at BEFORE UPDATE ON public.school_material_stock
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.school_material_stock ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'school_material_stock'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.school_material_stock', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "estoque_material view" ON public.school_material_stock
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'estoque_material'::public.app_module));

CREATE POLICY "estoque_material insert" ON public.school_material_stock
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'estoque_material'::public.app_module));

CREATE POLICY "estoque_material update" ON public.school_material_stock
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'estoque_material'::public.app_module))
  WITH CHECK (public.can_edit_module(auth.uid(), 'estoque_material'::public.app_module));

CREATE POLICY "estoque_material delete" ON public.school_material_stock
  FOR DELETE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'estoque_material'::public.app_module));

NOTIFY pgrst, 'reload schema';
