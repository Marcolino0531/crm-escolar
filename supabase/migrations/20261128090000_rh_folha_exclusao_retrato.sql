-- RH > Pagamentos > Salário: "Desfazer" uma exclusão da folha devolve o registro
-- à folha gravada, com os valores do extrato importado. Migration ADITIVA.
--
--   rh_folha_exclusoes.retrato     cópia do registro no momento da exclusão
--                                  (linha de rh_folha_colaboradores, rubricas e
--                                  restituição). Só na exclusão da competência;
--                                  nula nas fixas e nas exclusões anteriores.
--   rh_folha_excluir_colaborador   passa a gravar o retrato antes de apagar.
--   rh_folha_desfazer_exclusao     novo: recoloca o registro do retrato na
--                                  importação da empresa (mesmo status de
--                                  conferência), apaga a exclusão e grava o evento.
--
-- Acesso SOMENTE pelo servidor (service role), como antes: a tabela continua
-- com RLS ativo, sem policies e sem privilégio para anon/authenticated.

BEGIN;

ALTER TABLE public.rh_folha_exclusoes ADD COLUMN IF NOT EXISTS retrato jsonb;

-- ── Exclusão atômica de um registro da folha (agora com retrato) ────────────
-- p: { school_id, competencia, colaborador_id, motivo, fixa, por, por_nome }
CREATE OR REPLACE FUNCTION public.rh_folha_excluir_colaborador(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school   uuid := (p->>'school_id')::uuid;
  v_comp     text := p->>'competencia';
  v_col_id   uuid := (p->>'colaborador_id')::uuid;
  v_motivo   text := btrim(coalesce(p->>'motivo', ''));
  v_fixa     boolean := coalesce((p->>'fixa')::boolean, false);
  v_por      uuid := nullif(p->>'por', '')::uuid;
  v_por_nome text := coalesce(p->>'por_nome', '');
  v_col      record;
  v_retrato  jsonb;
BEGIN
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'O motivo da exclusão é obrigatório.';
  END IF;

  -- Mesma trava da gravação/fechamento do colégio × competência.
  PERFORM pg_advisory_xact_lock(hashtext('rh_folha:' || v_school::text || ':' || v_comp));

  IF EXISTS (SELECT 1 FROM public.rh_folha_importacoes
              WHERE school_id = v_school AND competencia = v_comp AND status = 'fechada') THEN
    RAISE EXCEPTION 'Competência fechada: somente leitura.';
  END IF;

  SELECT c.id, c.importacao_id, c.tipo, c.codigo, c.cpf, c.nome, i.cnpj
    INTO v_col
    FROM public.rh_folha_colaboradores c
    JOIN public.rh_folha_importacoes i ON i.id = c.importacao_id
   WHERE c.id = v_col_id AND i.school_id = v_school AND i.competencia = v_comp
   FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não pertence a esta folha.';
  END IF;

  -- Retrato completo para o "Desfazer" (valores, bases, rubricas, status).
  SELECT jsonb_build_object(
           'colaborador', to_jsonb(c.*),
           'rubricas', coalesce((SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.ordem)
                                   FROM public.rh_folha_rubricas r
                                  WHERE r.colaborador_id = c.id), '[]'::jsonb),
           'restituicao', (SELECT to_jsonb(x.*)
                             FROM public.rh_folha_restituicoes x
                            WHERE x.colaborador_id = c.id))
    INTO v_retrato
    FROM public.rh_folha_colaboradores c
   WHERE c.id = v_col.id;

  -- Histórico anterior do registro (guarda retrato com valores) sai junto.
  DELETE FROM public.rh_folha_eventos
   WHERE colaborador_id = v_col.id
      OR (importacao_id = v_col.importacao_id AND colaborador_id IS NULL
          AND tipo = 'retirada' AND dados->>'tipo' = v_col.tipo
          AND dados->>'codigo' = v_col.codigo);
  DELETE FROM public.rh_folha_restituicoes WHERE colaborador_id = v_col.id;
  DELETE FROM public.rh_folha_colaboradores WHERE id = v_col.id; -- rubricas: ON DELETE CASCADE

  INSERT INTO public.rh_folha_exclusoes (
    school_id, fixa, competencia, cnpj, tipo, codigo, cpf, nome, motivo,
    excluido_por, excluido_por_nome, retrato)
  VALUES (
    v_school, false, v_comp, v_col.cnpj, v_col.tipo, v_col.codigo, v_col.cpf, v_col.nome,
    v_motivo, v_por, v_por_nome, v_retrato)
  ON CONFLICT DO NOTHING;

  IF v_fixa THEN
    INSERT INTO public.rh_folha_exclusoes (
      school_id, fixa, competencia, cnpj, tipo, codigo, cpf, nome, motivo,
      excluido_por, excluido_por_nome)
    VALUES (
      v_school, true, NULL, v_col.cnpj, v_col.tipo, v_col.codigo,
      regexp_replace(v_col.cpf, '\D', '', 'g'), v_col.nome, v_motivo, v_por, v_por_nome)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Evento só com os dados mínimos (sem valores nem rubricas).
  INSERT INTO public.rh_folha_eventos (importacao_id, colaborador_id, tipo, dados, por, por_nome)
  VALUES (v_col.importacao_id, NULL, 'exclusao',
          jsonb_build_object('cnpj', v_col.cnpj, 'tipo', v_col.tipo, 'codigo', v_col.codigo,
                             'cpf', v_col.cpf, 'nome', v_col.nome, 'motivo', v_motivo,
                             'fixa', v_fixa),
          v_por, v_por_nome);
END;
$$;

REVOKE ALL ON FUNCTION public.rh_folha_excluir_colaborador(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_folha_excluir_colaborador(jsonb) TO service_role;

-- ── Desfazer exclusão ───────────────────────────────────────────────────────
-- p: { school_id, exclusao_id, por, por_nome }
-- Fixa: só apaga a exclusão (vale para as próximas importações).
-- Da competência (só aberta): recoloca o registro do retrato na importação da
-- empresa, com o mesmo status de conferência, e apaga a exclusão. Exclusão
-- sem retrato (anterior a esta migration): só apaga a exclusão; o registro
-- volta na próxima reimportação do PDF.
-- Devolve { restaurado: boolean, sem_copia: boolean }.
CREATE OR REPLACE FUNCTION public.rh_folha_desfazer_exclusao(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school   uuid := (p->>'school_id')::uuid;
  v_id       uuid := (p->>'exclusao_id')::uuid;
  v_por      uuid := nullif(p->>'por', '')::uuid;
  v_por_nome text := coalesce(p->>'por_nome', '');
  v_exc      public.rh_folha_exclusoes%ROWTYPE;
  v_imp_id   uuid;
  v_col      jsonb;
  v_col_id   uuid;
  v_rest     jsonb;
  v_sem_copia boolean := false;
BEGIN
  SELECT * INTO v_exc FROM public.rh_folha_exclusoes WHERE id = v_id AND school_id = v_school;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exclusão não encontrada nesta unidade.';
  END IF;

  IF v_exc.fixa THEN
    DELETE FROM public.rh_folha_exclusoes WHERE id = v_exc.id;
    RETURN jsonb_build_object('restaurado', false, 'sem_copia', false);
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('rh_folha:' || v_school::text || ':' || v_exc.competencia));

  SELECT * INTO v_exc FROM public.rh_folha_exclusoes WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exclusão não encontrada nesta unidade.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rh_folha_importacoes
              WHERE school_id = v_school AND competencia = v_exc.competencia
                AND status = 'fechada') THEN
    RAISE EXCEPTION 'Competência fechada: reabra para desfazer a exclusão.';
  END IF;

  SELECT i.id INTO v_imp_id
    FROM public.rh_folha_importacoes i
   WHERE i.school_id = v_school AND i.competencia = v_exc.competencia
     AND regexp_replace(i.cnpj, '\D', '', 'g') = regexp_replace(v_exc.cnpj, '\D', '', 'g');
  IF v_imp_id IS NULL THEN
    RAISE EXCEPTION 'A folha desta empresa não está mais importada nesta competência.';
  END IF;

  SELECT c.id INTO v_col_id
    FROM public.rh_folha_colaboradores c
   WHERE c.importacao_id = v_imp_id AND c.tipo = v_exc.tipo AND c.codigo = v_exc.codigo;

  IF v_col_id IS NULL AND jsonb_typeof(v_exc.retrato->'colaborador') IS DISTINCT FROM 'object' THEN
    v_sem_copia := true;
  ELSIF v_col_id IS NULL THEN
    v_col := v_exc.retrato->'colaborador';
    -- Referências que podem ter sumido desde a exclusão viram nulas.
    v_col := v_col || jsonb_build_object(
      'importacao_id', v_imp_id,
      'funcionario_id', CASE WHEN EXISTS (SELECT 1 FROM public.funcionarios f
                                           WHERE f.id = (v_col->>'funcionario_id')::uuid)
                             THEN v_col->'funcionario_id' ELSE 'null'::jsonb END,
      'confirmado_por', CASE WHEN EXISTS (SELECT 1 FROM auth.users u
                                           WHERE u.id = (v_col->>'confirmado_por')::uuid)
                             THEN v_col->'confirmado_por' ELSE 'null'::jsonb END,
      'ajustado_por', CASE WHEN EXISTS (SELECT 1 FROM auth.users u
                                         WHERE u.id = (v_col->>'ajustado_por')::uuid)
                           THEN v_col->'ajustado_por' ELSE 'null'::jsonb END,
      'atualizado_em', to_jsonb(now()));

    INSERT INTO public.rh_folha_colaboradores
    SELECT * FROM jsonb_populate_record(NULL::public.rh_folha_colaboradores, v_col)
    RETURNING id INTO v_col_id;

    INSERT INTO public.rh_folha_rubricas
    SELECT * FROM jsonb_populate_recordset(
      NULL::public.rh_folha_rubricas,
      (SELECT coalesce(jsonb_agg(r || jsonb_build_object('colaborador_id', v_col_id)), '[]'::jsonb)
         FROM jsonb_array_elements(coalesce(v_exc.retrato->'rubricas', '[]'::jsonb)) AS r));

    v_rest := v_exc.retrato->'restituicao';
    IF jsonb_typeof(v_rest) = 'object' THEN
      v_rest := v_rest || jsonb_build_object(
        'importacao_id', v_imp_id,
        'colaborador_id', v_col_id,
        'funcionario_id', CASE WHEN EXISTS (SELECT 1 FROM public.funcionarios f
                                             WHERE f.id = (v_rest->>'funcionario_id')::uuid)
                               THEN v_rest->'funcionario_id' ELSE 'null'::jsonb END,
        'gravado_por', CASE WHEN EXISTS (SELECT 1 FROM auth.users u
                                          WHERE u.id = (v_rest->>'gravado_por')::uuid)
                            THEN v_rest->'gravado_por' ELSE 'null'::jsonb END);
      INSERT INTO public.rh_folha_restituicoes
      SELECT * FROM jsonb_populate_record(NULL::public.rh_folha_restituicoes, v_rest);
    END IF;
  END IF;

  DELETE FROM public.rh_folha_exclusoes WHERE id = v_exc.id;

  -- Evento só com os dados mínimos (sem valores nem rubricas).
  INSERT INTO public.rh_folha_eventos (importacao_id, colaborador_id, tipo, dados, por, por_nome)
  VALUES (v_imp_id, v_col_id, 'exclusao_desfeita',
          jsonb_build_object('cnpj', v_exc.cnpj, 'tipo', v_exc.tipo, 'codigo', v_exc.codigo,
                             'cpf', v_exc.cpf, 'nome', v_exc.nome,
                             'restaurado', NOT v_sem_copia),
          v_por, v_por_nome);

  RETURN jsonb_build_object('restaurado', NOT v_sem_copia, 'sem_copia', v_sem_copia);
END;
$$;

REVOKE ALL ON FUNCTION public.rh_folha_desfazer_exclusao(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_folha_desfazer_exclusao(jsonb) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
