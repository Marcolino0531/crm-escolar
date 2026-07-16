-- Companheira de 20260710120000_colonia_financeiro_module_enum.sql.
--
-- Estende as policies de LEITURA para que o nível FINANCEIRO ('colonia_financeiro')
-- também consiga carregar o Fechamento Semanal mesmo quando o usuário NÃO tem o
-- nível Operacional ('colonia'):
--   • public.holiday_camp_records  → SELECT liberado a colonia OU colonia_financeiro.
--   • roster (diario_students / diario_classes) → idem, para listar as crianças.
--
-- As policies de ESCRITA (insert/update/delete) de holiday_camp_records
-- continuam restritas ao nível Operacional ('colonia'): correções de registros
-- durante a auditoria exigem permissão de edição operacional.

DROP POLICY IF EXISTS "colonia view holiday_camp_records" ON public.holiday_camp_records;
CREATE POLICY "colonia view holiday_camp_records" ON public.holiday_camp_records
  FOR SELECT TO authenticated
  USING (
    public.can_view_module(auth.uid(), 'colonia'::public.app_module)
    OR public.can_view_module(auth.uid(), 'colonia_financeiro'::public.app_module)
  );

-- Estende o SELECT do roster (Sponte) para o nível Financeiro da Colônia também.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['diario_classes', 'diario_students'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "diario view %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "diario/colonia view %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "diario/colonia view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''diario''::public.app_module) OR public.can_view_module(auth.uid(), ''colonia''::public.app_module) OR public.can_view_module(auth.uid(), ''colonia_financeiro''::public.app_module))',
      t, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
