-- RH > Pagamentos > Salário: "Líquido a pagar" manual no Ajustar. Migration ADITIVA.
--
--   rh_folha_colaboradores.liquido_manual  valor realmente pago ao registro,
--                                          quando difere do líquido calculado
--                                          (proventos − descontos). Nulo = paga o
--                                          líquido da folha. Não altera rubricas,
--                                          proventos, descontos nem liquido.
--   rh_folha_ajustar_colaborador           passa a receber e gravar liquido_manual
--                                          (nulo quando igual ao calculado).
--   rh_folha_gravar_importacao             registro substituído na reimportação
--                                          perde o liquido_manual junto com os
--                                          demais ajustes; o igual não é tocado.
--
-- Sem mudança em RLS, privilégios, CHECK de rh_folha_eventos.tipo (o evento
-- continua 'ajuste') nem nas funções de exclusão: o retrato (to_jsonb da linha) e
-- o Desfazer (jsonb_populate_record) já levam a coluna nova.

BEGIN;

ALTER TABLE public.rh_folha_colaboradores
  ADD COLUMN IF NOT EXISTS liquido_manual numeric(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.rh_folha_colaboradores'::regclass
                    AND conname = 'rh_folha_colaboradores_liquido_manual_check') THEN
    ALTER TABLE public.rh_folha_colaboradores
      ADD CONSTRAINT rh_folha_colaboradores_liquido_manual_check
      CHECK (liquido_manual IS NULL OR liquido_manual >= 0);
  END IF;
END;
$$;

-- ── Gravação atômica da importação/reimportação de UMA empresa ───────────────
-- Igual à anterior; o registro substituído também perde o liquido_manual.
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
        liquido_manual = NULL,
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
-- Igual ao anterior + p.liquido_manual (numérico >= 0 ou nulo).
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
  v_liquido_manual numeric(12, 2) := nullif(p->>'liquido_manual', '')::numeric;
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
  IF v_liquido_manual < 0 THEN
    RAISE EXCEPTION 'O líquido a pagar não pode ser negativo.';
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
    liquido_manual = v_liquido_manual,
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
