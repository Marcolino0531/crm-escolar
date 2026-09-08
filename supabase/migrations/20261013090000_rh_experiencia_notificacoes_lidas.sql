-- Avisos de fim do período de experiência (45 e 90 dias) marcados como lidos.
-- O aviso em si é calculado na hora, a partir de funcionarios.data_admissao;
-- aqui só fica o registro de quem marcou cada marco como lido. Marcar como
-- lido não apaga nada: a linha é o que tira o aviso da lista de pendentes.

CREATE TABLE IF NOT EXISTS public.rh_experiencia_notificacoes_lidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios (id) ON DELETE CASCADE,
  marco integer NOT NULL CHECK (marco IN (45, 90)),
  lido_em timestamptz NOT NULL DEFAULT now(),
  lido_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  UNIQUE (funcionario_id, marco)
);

ALTER TABLE public.rh_experiencia_notificacoes_lidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rh experiencia lidas select" ON public.rh_experiencia_notificacoes_lidas;
CREATE POLICY "rh experiencia lidas select" ON public.rh_experiencia_notificacoes_lidas
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rh'::public.app_module));

DROP POLICY IF EXISTS "rh experiencia lidas insert" ON public.rh_experiencia_notificacoes_lidas;
CREATE POLICY "rh experiencia lidas insert" ON public.rh_experiencia_notificacoes_lidas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_edit_module(auth.uid(), 'rh'::public.app_module)
    AND lido_por = auth.uid()
  );
