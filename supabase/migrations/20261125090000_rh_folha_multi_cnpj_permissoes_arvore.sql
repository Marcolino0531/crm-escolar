-- RH > Pagamentos > Salário: colégio com mais de uma empresa (CNPJ) na Folha de
-- Pagamento e cadastro "CNPJs Folha de Pagamento" (Configurações > Cadastros Gerais).
-- Migration ADITIVA: não apaga nem altera dados. As importações existentes ficam
-- com o CNPJ que já têm gravado.
--
--   rh_folha_importacoes    única por colégio × competência × CNPJ (só dígitos)
--   rh_folha_colaboradores  única por importação × tipo × código
--   rh_folha_cnpjs          CNPJs adicionais aceitos na Folha, por colégio
--   app_module              nova página configuracoes.cadastros.cnpjs_folha
--                           (sem cópia de acesso: começa só com admin)
--
-- Acesso SOMENTE pelo servidor (service role): RLS ativo, sem policies,
-- REVOKE de anon/authenticated.

BEGIN;

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.cadastros.cnpjs_folha';

-- ── Importação: colégio × competência × CNPJ ────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.rh_folha_importacoes'::regclass
       AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
              FROM unnest(c.conkey) AS k(attnum)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
           = ARRAY['competencia', 'school_id']
  LOOP
    EXECUTE format('ALTER TABLE public.rh_folha_importacoes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS rh_folha_importacoes_school_comp_cnpj_key
  ON public.rh_folha_importacoes (school_id, competencia, (regexp_replace(cnpj, '\D', '', 'g')));

-- ── Colaborador: importação × tipo × código ─────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.rh_folha_colaboradores'::regclass
       AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
              FROM unnest(c.conkey) AS k(attnum)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
           = ARRAY['codigo', 'importacao_id']
  LOOP
    EXECUTE format('ALTER TABLE public.rh_folha_colaboradores DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.rh_folha_colaboradores'::regclass
       AND conname = 'rh_folha_colaboradores_importacao_tipo_codigo_key'
  ) THEN
    ALTER TABLE public.rh_folha_colaboradores
      ADD CONSTRAINT rh_folha_colaboradores_importacao_tipo_codigo_key
      UNIQUE (importacao_id, tipo, codigo);
  END IF;
END;
$$;

-- ── CNPJs Folha de Pagamento (adicionais ao CNPJ do cadastro do colégio) ─────
CREATE TABLE IF NOT EXISTS public.rh_folha_cnpjs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  cnpj                text NOT NULL CHECK (cnpj ~ '^\d{14}$'),
  empresa             text NOT NULL CHECK (btrim(empresa) <> ''),
  observacao          text NOT NULL DEFAULT '',
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  criado_por_nome     text NOT NULL DEFAULT '',
  atualizado_em       timestamptz,
  atualizado_por      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  atualizado_por_nome text,
  UNIQUE (school_id, cnpj)
);

ALTER TABLE public.rh_folha_cnpjs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rh_folha_cnpjs FROM anon, authenticated;
GRANT ALL ON public.rh_folha_cnpjs TO service_role;

-- ── Gravação atômica da importação/reimportação de UMA empresa ───────────────
-- p: { school_id, competencia, empresa, cnpj, cnpj_colegio, cnpj_divergente,
--      total_proventos, total_descontos, liquido_geral, total_colaboradores,
--      por, por_nome, gravar: [colaborador + rubricas], retirar: [{ tipo, codigo }] }
-- Mesmo CNPJ (só dígitos) = reimportação DESTA empresa; outro CNPJ = outra
-- importação, que não é tocada. Colaboradores fora de "gravar" e de "retirar"
-- ficam exatamente como estão.
CREATE OR REPLACE FUNCTION public.rh_folha_gravar_importacao(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imp      uuid;
  v_nova     boolean := false;
  v_col      jsonb;
  v_rub      jsonb;
  v_ret      jsonb;
  v_col_id   uuid;
  v_ordem    integer;
  v_por      uuid := nullif(p->>'por', '')::uuid;
  v_por_nome text := coalesce(p->>'por_nome', '');
  v_school   uuid := (p->>'school_id')::uuid;
  v_comp     text := p->>'competencia';
  v_cnpj     text := regexp_replace(coalesce(p->>'cnpj', ''), '\D', '', 'g');
BEGIN
  IF v_cnpj = '' THEN
    RAISE EXCEPTION 'PDF sem CNPJ: nada foi importado.';
  END IF;

  -- Uma gravação/fechamento por vez em cada colégio × competência.
  PERFORM pg_advisory_xact_lock(hashtext('rh_folha:' || v_school::text || ':' || v_comp));

  IF EXISTS (SELECT 1 FROM public.rh_folha_importacoes
              WHERE school_id = v_school AND competencia = v_comp AND status = 'fechada') THEN
    RAISE EXCEPTION 'Competência fechada: não aceita PDF de nenhuma empresa até ser reaberta.';
  END IF;

  SELECT id INTO v_imp
    FROM public.rh_folha_importacoes
   WHERE school_id = v_school AND competencia = v_comp
     AND regexp_replace(cnpj, '\D', '', 'g') = v_cnpj
   FOR UPDATE;

  IF v_imp IS NULL THEN
    v_nova := true;
    INSERT INTO public.rh_folha_importacoes (
      school_id, competencia, empresa, cnpj, cnpj_colegio, cnpj_divergente, calculo,
      total_proventos, total_descontos, liquido_geral, total_colaboradores,
      importado_por, importado_por_nome)
    VALUES (
      v_school, v_comp, coalesce(p->>'empresa', ''),
      coalesce(p->>'cnpj', ''), coalesce(p->>'cnpj_colegio', ''),
      coalesce((p->>'cnpj_divergente')::boolean, false), 'Folha Mensal',
      (p->>'total_proventos')::numeric, (p->>'total_descontos')::numeric,
      (p->>'liquido_geral')::numeric, (p->>'total_colaboradores')::integer,
      v_por, v_por_nome)
    RETURNING id INTO v_imp;
  ELSE
    UPDATE public.rh_folha_importacoes SET
      empresa = coalesce(p->>'empresa', ''), cnpj = coalesce(p->>'cnpj', ''),
      cnpj_colegio = coalesce(p->>'cnpj_colegio', ''),
      cnpj_divergente = coalesce((p->>'cnpj_divergente')::boolean, false),
      total_proventos = (p->>'total_proventos')::numeric,
      total_descontos = (p->>'total_descontos')::numeric,
      liquido_geral = (p->>'liquido_geral')::numeric,
      total_colaboradores = (p->>'total_colaboradores')::integer,
      reimportado_em = now(), reimportado_por = v_por, reimportado_por_nome = v_por_nome
    WHERE id = v_imp;
  END IF;

  INSERT INTO public.rh_folha_eventos (importacao_id, tipo, dados, por, por_nome)
  VALUES (v_imp, CASE WHEN v_nova THEN 'importacao' ELSE 'reimportacao' END,
          jsonb_build_object('total_colaboradores', p->'total_colaboradores',
                             'gravados', jsonb_array_length(coalesce(p->'gravar', '[]'::jsonb)),
                             'retirados', jsonb_array_length(coalesce(p->'retirar', '[]'::jsonb))),
          v_por, v_por_nome);

  FOR v_ret IN SELECT * FROM jsonb_array_elements(coalesce(p->'retirar', '[]'::jsonb)) LOOP
    SELECT id INTO v_col_id FROM public.rh_folha_colaboradores
     WHERE importacao_id = v_imp AND tipo = v_ret->>'tipo' AND codigo = v_ret->>'codigo';
    IF v_col_id IS NOT NULL THEN
      INSERT INTO public.rh_folha_eventos (importacao_id, colaborador_id, tipo, dados, por, por_nome)
      SELECT v_imp, NULL, 'retirada',
             to_jsonb(c) || jsonb_build_object('rubricas',
               coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.ordem)
                           FROM public.rh_folha_rubricas r WHERE r.colaborador_id = c.id), '[]'::jsonb)),
             v_por, v_por_nome
        FROM public.rh_folha_colaboradores c WHERE c.id = v_col_id;
      DELETE FROM public.rh_folha_restituicoes WHERE colaborador_id = v_col_id;
      DELETE FROM public.rh_folha_colaboradores WHERE id = v_col_id;
    END IF;
  END LOOP;

  FOR v_col IN SELECT * FROM jsonb_array_elements(coalesce(p->'gravar', '[]'::jsonb)) LOOP
    SELECT id INTO v_col_id FROM public.rh_folha_colaboradores
     WHERE importacao_id = v_imp AND tipo = v_col->>'tipo' AND codigo = v_col->>'codigo';
    IF v_col_id IS NOT NULL THEN
      INSERT INTO public.rh_folha_eventos (importacao_id, colaborador_id, tipo, dados, por, por_nome)
      SELECT v_imp, c.id, 'substituicao',
             to_jsonb(c) || jsonb_build_object('rubricas',
               coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.ordem)
                           FROM public.rh_folha_rubricas r WHERE r.colaborador_id = c.id), '[]'::jsonb)),
             v_por, v_por_nome
        FROM public.rh_folha_colaboradores c WHERE c.id = v_col_id;
      DELETE FROM public.rh_folha_rubricas WHERE colaborador_id = v_col_id;
      UPDATE public.rh_folha_colaboradores SET
        funcionario_id = nullif(v_col->>'funcionario_id', '')::uuid,
        vinculo_manual = coalesce((v_col->>'vinculo_manual')::boolean, false),
        nome = v_col->>'nome', cpf = coalesce(v_col->>'cpf', ''),
        situacao = coalesce(v_col->>'situacao', ''), vinculo = coalesce(v_col->>'vinculo', ''),
        admissao = coalesce(v_col->>'admissao', ''), cargo_codigo = coalesce(v_col->>'cargo_codigo', ''),
        cargo = coalesce(v_col->>'cargo', ''), cbo = coalesce(v_col->>'cbo', ''),
        horas_mes = coalesce(v_col->>'horas_mes', ''),
        salario_base = (v_col->>'salario_base')::numeric,
        informativa = (v_col->>'informativa')::numeric,
        informativa_dedutora = (v_col->>'informativa_dedutora')::numeric,
        base_inss = (v_col->>'base_inss')::numeric, excedente_inss = (v_col->>'excedente_inss')::numeric,
        base_fgts = (v_col->>'base_fgts')::numeric, valor_fgts = (v_col->>'valor_fgts')::numeric,
        base_irrf = (v_col->>'base_irrf')::numeric,
        observacoes = coalesce(ARRAY(SELECT jsonb_array_elements_text(v_col->'observacoes')), '{}'),
        proventos_pdf = (v_col->>'proventos')::numeric, descontos_pdf = (v_col->>'descontos')::numeric,
        liquido_pdf = (v_col->>'liquido')::numeric,
        proventos = (v_col->>'proventos')::numeric, descontos = (v_col->>'descontos')::numeric,
        liquido = (v_col->>'liquido')::numeric,
        status = v_col->>'status', divergencias = coalesce(v_col->'divergencias', '[]'::jsonb),
        confirmado_em = CASE WHEN v_col->>'status' = 'confirmado' THEN now() END,
        confirmado_por = CASE WHEN v_col->>'status' = 'confirmado' THEN v_por END,
        confirmado_por_nome = CASE WHEN v_col->>'status' = 'confirmado' THEN v_por_nome END,
        ajustado_em = NULL, ajustado_por = NULL, ajustado_por_nome = NULL, ajuste_observacao = NULL,
        atualizado_em = now()
      WHERE id = v_col_id;
    ELSE
      INSERT INTO public.rh_folha_colaboradores (
        importacao_id, funcionario_id, vinculo_manual, tipo, codigo, nome, cpf, situacao, vinculo,
        admissao, cargo_codigo, cargo, cbo, horas_mes, salario_base, informativa,
        informativa_dedutora, base_inss, excedente_inss, base_fgts, valor_fgts, base_irrf,
        observacoes, proventos_pdf, descontos_pdf, liquido_pdf, proventos, descontos, liquido,
        status, divergencias, confirmado_em, confirmado_por, confirmado_por_nome)
      VALUES (
        v_imp, nullif(v_col->>'funcionario_id', '')::uuid,
        coalesce((v_col->>'vinculo_manual')::boolean, false), v_col->>'tipo', v_col->>'codigo',
        v_col->>'nome', coalesce(v_col->>'cpf', ''), coalesce(v_col->>'situacao', ''),
        coalesce(v_col->>'vinculo', ''), coalesce(v_col->>'admissao', ''),
        coalesce(v_col->>'cargo_codigo', ''), coalesce(v_col->>'cargo', ''),
        coalesce(v_col->>'cbo', ''), coalesce(v_col->>'horas_mes', ''),
        (v_col->>'salario_base')::numeric, (v_col->>'informativa')::numeric,
        (v_col->>'informativa_dedutora')::numeric, (v_col->>'base_inss')::numeric,
        (v_col->>'excedente_inss')::numeric, (v_col->>'base_fgts')::numeric,
        (v_col->>'valor_fgts')::numeric, (v_col->>'base_irrf')::numeric,
        coalesce(ARRAY(SELECT jsonb_array_elements_text(v_col->'observacoes')), '{}'),
        (v_col->>'proventos')::numeric, (v_col->>'descontos')::numeric, (v_col->>'liquido')::numeric,
        (v_col->>'proventos')::numeric, (v_col->>'descontos')::numeric, (v_col->>'liquido')::numeric,
        v_col->>'status', coalesce(v_col->'divergencias', '[]'::jsonb),
        CASE WHEN v_col->>'status' = 'confirmado' THEN now() END,
        CASE WHEN v_col->>'status' = 'confirmado' THEN v_por END,
        CASE WHEN v_col->>'status' = 'confirmado' THEN v_por_nome END)
      RETURNING id INTO v_col_id;
    END IF;

    v_ordem := 0;
    FOR v_rub IN SELECT * FROM jsonb_array_elements(coalesce(v_col->'rubricas', '[]'::jsonb)) LOOP
      v_ordem := v_ordem + 1;
      INSERT INTO public.rh_folha_rubricas (
        colaborador_id, ordem, tipo, codigo, descricao, referencia, valor_hora, valor,
        valor_original, origem)
      VALUES (
        v_col_id, v_ordem, v_rub->>'tipo', coalesce(v_rub->>'codigo', ''), v_rub->>'descricao',
        coalesce(v_rub->>'referencia', ''), coalesce(v_rub->>'valor_hora', ''),
        (v_rub->>'valor')::numeric, (v_rub->>'valor')::numeric, 'pdf');
    END LOOP;
  END LOOP;

  RETURN v_imp;
END;
$$;

-- ── Ajuste manual atômico de um colaborador Em conferência ──────────────────
-- Igual ao anterior, mas a competência é fechada quando QUALQUER empresa do
-- colégio nela está fechada (todas fecham e reabrem juntas).
CREATE OR REPLACE FUNCTION public.rh_folha_ajustar_colaborador(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col      public.rh_folha_colaboradores%ROWTYPE;
  v_rub      jsonb;
  v_ordem    integer := 0;
  v_por      uuid := nullif(p->>'por', '')::uuid;
  v_por_nome text := coalesce(p->>'por_nome', '');
BEGIN
  SELECT * INTO v_col FROM public.rh_folha_colaboradores
   WHERE id = (p->>'colaborador_id')::uuid FOR UPDATE;
  IF v_col.id IS NULL THEN RAISE EXCEPTION 'Colaborador não encontrado.'; END IF;
  IF EXISTS (
    SELECT 1
      FROM public.rh_folha_importacoes i
      JOIN public.rh_folha_importacoes o
        ON o.school_id = i.school_id AND o.competencia = i.competencia
     WHERE i.id = v_col.importacao_id AND o.status = 'fechada'
  ) THEN
    RAISE EXCEPTION 'Competência fechada: somente leitura.';
  END IF;
  IF v_col.status <> 'em_conferencia' THEN
    RAISE EXCEPTION 'Colaborador confirmado: reabra a conferência para ajustar.';
  END IF;
  IF coalesce(btrim(p->>'observacao'), '') = '' THEN
    RAISE EXCEPTION 'A observação do ajuste é obrigatória.';
  END IF;

  INSERT INTO public.rh_folha_eventos (importacao_id, colaborador_id, tipo, dados, por, por_nome)
  SELECT v_col.importacao_id, v_col.id, 'ajuste',
         to_jsonb(v_col) || jsonb_build_object(
           'observacao', p->>'observacao',
           'rubricas', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.ordem)
                                   FROM public.rh_folha_rubricas r WHERE r.colaborador_id = v_col.id), '[]'::jsonb)),
         v_por, v_por_nome;

  DELETE FROM public.rh_folha_rubricas WHERE colaborador_id = v_col.id;
  FOR v_rub IN SELECT * FROM jsonb_array_elements(coalesce(p->'rubricas', '[]'::jsonb)) LOOP
    v_ordem := v_ordem + 1;
    INSERT INTO public.rh_folha_rubricas (
      colaborador_id, ordem, tipo, codigo, descricao, referencia, valor_hora, valor,
      valor_original, origem, removida)
    VALUES (
      v_col.id, v_ordem, v_rub->>'tipo', coalesce(v_rub->>'codigo', ''), v_rub->>'descricao',
      coalesce(v_rub->>'referencia', ''), coalesce(v_rub->>'valor_hora', ''),
      (v_rub->>'valor')::numeric, nullif(v_rub->>'valor_original', '')::numeric,
      v_rub->>'origem', coalesce((v_rub->>'removida')::boolean, false));
  END LOOP;

  UPDATE public.rh_folha_colaboradores SET
    proventos = (p->>'proventos')::numeric,
    descontos = (p->>'descontos')::numeric,
    liquido = (p->>'liquido')::numeric,
    ajustado_em = now(), ajustado_por = v_por, ajustado_por_nome = v_por_nome,
    ajuste_observacao = btrim(p->>'observacao'),
    atualizado_em = now()
  WHERE id = v_col.id;
END;
$$;

REVOKE ALL ON FUNCTION public.rh_folha_gravar_importacao(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rh_folha_ajustar_colaborador(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_folha_gravar_importacao(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rh_folha_ajustar_colaborador(jsonb) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
