-- O cadastro de Material Pedagógico por Série saiu de Configurações e passou a
-- ficar dentro do módulo de Rematrícula: a leitura segue a permissão de lá.

DROP POLICY IF EXISTS material_pedagogico_series_select ON public.material_pedagogico_series;
CREATE POLICY material_pedagogico_series_select ON public.material_pedagogico_series
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));

DROP POLICY IF EXISTS rematricula_config_select ON public.rematricula_config;
CREATE POLICY rematricula_config_select ON public.rematricula_config
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));
