-- RH: cargo dos funcionários em Title Case.
--
-- Estende o trigger de 20260916120000 (nome_completo) para também formatar
-- funcionarios.cargo ("ESTAGIÁRIA" → "Estagiária", "AUXILIAR DE LIMPEZA" →
-- "Auxiliar de Limpeza"). Nenhuma outra tabela copia funcionarios.cargo
-- (recibos.assinante_cargo é o cargo do assinante do colégio, cadastro próprio),
-- então o backfill é só em funcionarios.

CREATE OR REPLACE FUNCTION public.funcionarios_format_names()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.nome_completo := public.title_case(NEW.nome_completo);
  NEW.cargo := public.title_case(NEW.cargo);
  RETURN NEW;
END;
$$;

UPDATE public.funcionarios
   SET cargo = public.title_case(cargo)
 WHERE cargo IS DISTINCT FROM public.title_case(cargo);
