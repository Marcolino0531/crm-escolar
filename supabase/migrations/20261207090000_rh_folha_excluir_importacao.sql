-- RH > Pagamentos > Salário > Folha: excluir de uma vez a importação inteira de
-- uma empresa (uma linha de rh_folha_importacoes) em uma competência ABERTA.
-- Migration ADITIVA: não apaga nem altera nenhum dado existente.
--
--   rh_folha_importacoes_excluidas  registro mínimo de cada exclusão (colégio,
--                                   competência, CNPJ, empresa, quantidade de
--                                   registros, totais, quem e quando). Sem nomes,
--                                   CPFs nem valores por pessoa. Sem tela.
--   rh_folha_excluir_importacao     apaga, em uma transação, os eventos, as
--                                   restituições, os colaboradores (rubricas em
--                                   cascata) da importação, as exclusões DA
--                                   COMPETÊNCIA (fixa = false) daquele colégio,
--                                   competência e CNPJ, e a própria importação.
--                                   Não toca exclusões fixas, marcações de
--                                   restituição do INSS, CNPJs, Folhas Salvas,
--                                   salários nem outra empresa ou competência.
--
-- Acesso SOMENTE pelo servidor (service role): RLS ativo, sem policies, sem
-- privilégio para anon/authenticated; EXECUTE só para service_role.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rh_folha_importacoes_excluidas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  competencia       text NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  cnpj              text NOT NULL DEFAULT '',
  empresa           text NOT NULL DEFAULT '',
  registros         integer NOT NULL CHECK (registros >= 0),
  total_proventos   numeric(14, 2) NOT NULL,
  total_descontos   numeric(14, 2) NOT NULL,
  liquido_geral     numeric(14, 2) NOT NULL,
  excluido_em       timestamptz NOT NULL DEFAULT now(),
  excluido_por      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  excluido_por_nome text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS rh_folha_importacoes_excluidas_school_idx
  ON public.rh_folha_importacoes_excluidas (school_id, competencia);

ALTER TABLE public.rh_folha_importacoes_excluidas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rh_folha_importacoes_excluidas FROM anon, authenticated;
GRANT ALL ON public.rh_folha_importacoes_excluidas TO service_role;

-- p: { school_id, competencia, importacao_id, registros, total_proventos,
--      total_descontos, liquido_geral, por, por_nome }
-- Os totais vêm do servidor (função pura) e são conferidos aqui com os registros
-- apagados: se a folha mudou entre a leitura e a trava, nada é apagado.
CREATE OR REPLACE FUNCTION public.rh_folha_excluir_importacao(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school   uuid := (p->>'school_id')::uuid;
  v_comp     text := p->>'competencia';
  v_imp_id   uuid := (p->>'importacao_id')::uuid;
  v_por      uuid := nullif(p->>'por', '')::uuid;
  v_por_nome text := coalesce(p->>'por_nome', '');
  v_imp      record;
  v_qtd      integer;
  v_prov     numeric;
  v_desc     numeric;
  v_liq      numeric;
BEGIN
  -- Mesma trava da gravação/fechamento/exclusão do colégio × competência.
  PERFORM pg_advisory_xact_lock(hashtext('rh_folha:' || v_school::text || ':' || v_comp));

  SELECT i.id, i.cnpj, i.empresa
    INTO v_imp
    FROM public.rh_folha_importacoes i
   WHERE i.id = v_imp_id AND i.school_id = v_school AND i.competencia = v_comp
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Importação não encontrada nesta competência.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rh_folha_importacoes
              WHERE school_id = v_school AND competencia = v_comp AND status = 'fechada') THEN
    RAISE EXCEPTION 'Competência fechada: reabra para excluir a importação.';
  END IF;

  SELECT count(*), coalesce(sum(proventos), 0), coalesce(sum(descontos), 0),
         coalesce(sum(liquido), 0)
    INTO v_qtd, v_prov, v_desc, v_liq
    FROM public.rh_folha_colaboradores
   WHERE importacao_id = v_imp.id;

  IF v_qtd <> (p->>'registros')::integer
     OR v_prov <> (p->>'total_proventos')::numeric
     OR v_desc <> (p->>'total_descontos')::numeric
     OR v_liq <> (p->>'liquido_geral')::numeric THEN
    RAISE EXCEPTION 'A folha desta empresa mudou durante a exclusão. Recarregue a tela e tente de novo.';
  END IF;

  DELETE FROM public.rh_folha_eventos WHERE importacao_id = v_imp.id;
  DELETE FROM public.rh_folha_restituicoes WHERE importacao_id = v_imp.id;
  DELETE FROM public.rh_folha_colaboradores WHERE importacao_id = v_imp.id; -- rubricas: ON DELETE CASCADE
  DELETE FROM public.rh_folha_exclusoes
   WHERE school_id = v_school AND NOT fixa AND competencia = v_comp
     AND regexp_replace(cnpj, '\D', '', 'g') = regexp_replace(v_imp.cnpj, '\D', '', 'g');
  DELETE FROM public.rh_folha_importacoes WHERE id = v_imp.id;

  INSERT INTO public.rh_folha_importacoes_excluidas (
    school_id, competencia, cnpj, empresa, registros, total_proventos, total_descontos,
    liquido_geral, excluido_por, excluido_por_nome)
  VALUES (
    v_school, v_comp, v_imp.cnpj, v_imp.empresa, v_qtd, v_prov, v_desc, v_liq, v_por, v_por_nome);
END;
$$;

REVOKE ALL ON FUNCTION public.rh_folha_excluir_importacao(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_folha_excluir_importacao(jsonb) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
