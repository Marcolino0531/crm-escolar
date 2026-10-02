-- RH > Pagamentos > Salário: Folha de Pagamento importada do "Extrato Mensal"
-- (Domínio). O PDF é lido só no navegador; aqui ficam apenas os dados
-- estruturados. Migration ADITIVA: só cria tabelas, índices e funções novas.
--
--   rh_folha_importacoes              1 por colégio × competência (totais, aberta/fechada)
--   rh_folha_colaboradores            cada colaborador lido (dados do PDF + totais vigentes)
--   rh_folha_rubricas                 rubricas (valor vigente, valor original do PDF, origem)
--   rh_folha_eventos                  trilha: importação, substituição, confirmação, ajuste…
--   rh_restituicao_inss_marcacoes     "Recebe restituição do INSS" por funcionário (vigente)
--   rh_restituicao_inss_historico     quem marcou/desmarcou e quando
--   rh_folha_restituicoes             restituição gravada no fechamento da competência
--
-- Acesso SOMENTE pelo servidor (server functions com service role, que checam
-- rh.pagamentos.salario): RLS ativo, sem policies, REVOKE de anon/authenticated.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rh_folha_importacoes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  competencia         text NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  empresa             text NOT NULL DEFAULT '',
  cnpj                text NOT NULL DEFAULT '',
  cnpj_colegio        text NOT NULL DEFAULT '',
  cnpj_divergente     boolean NOT NULL DEFAULT false,
  calculo             text NOT NULL CHECK (calculo = 'Folha Mensal'),
  total_proventos     numeric(14, 2) NOT NULL,
  total_descontos     numeric(14, 2) NOT NULL,
  liquido_geral       numeric(14, 2) NOT NULL,
  total_colaboradores integer NOT NULL CHECK (total_colaboradores >= 0),
  status              text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'fechada')),
  importado_em        timestamptz NOT NULL DEFAULT now(),
  importado_por       uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  importado_por_nome  text NOT NULL DEFAULT '',
  reimportado_em      timestamptz,
  reimportado_por     uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reimportado_por_nome text,
  fechado_em          timestamptz,
  fechado_por         uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  fechado_por_nome    text,
  reaberto_em         timestamptz,
  reaberto_por        uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reaberto_por_nome   text,
  UNIQUE (school_id, competencia),
  CHECK (status = 'aberta' OR fechado_em IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS rh_folha_importacoes_school_comp_idx
  ON public.rh_folha_importacoes (school_id, competencia DESC);

CREATE TABLE IF NOT EXISTS public.rh_folha_colaboradores (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id         uuid NOT NULL REFERENCES public.rh_folha_importacoes (id) ON DELETE RESTRICT,
  funcionario_id        uuid REFERENCES public.funcionarios (id) ON DELETE SET NULL,
  vinculo_manual        boolean NOT NULL DEFAULT false,
  tipo                  text NOT NULL CHECK (tipo IN ('empregado', 'contribuinte')),
  codigo                text NOT NULL,
  nome                  text NOT NULL,
  cpf                   text NOT NULL DEFAULT '' CHECK (cpf ~ '^\d*$'),
  situacao              text NOT NULL DEFAULT '',
  vinculo               text NOT NULL DEFAULT '',
  admissao              text NOT NULL DEFAULT '',
  cargo_codigo          text NOT NULL DEFAULT '',
  cargo                 text NOT NULL DEFAULT '',
  cbo                   text NOT NULL DEFAULT '',
  horas_mes             text NOT NULL DEFAULT '',
  salario_base          numeric(12, 2) NOT NULL DEFAULT 0,
  informativa           numeric(12, 2) NOT NULL DEFAULT 0,
  informativa_dedutora  numeric(12, 2) NOT NULL DEFAULT 0,
  base_inss             numeric(12, 2) NOT NULL DEFAULT 0,
  excedente_inss        numeric(12, 2) NOT NULL DEFAULT 0,
  base_fgts             numeric(12, 2) NOT NULL DEFAULT 0,
  valor_fgts            numeric(12, 2) NOT NULL DEFAULT 0,
  base_irrf             numeric(12, 2) NOT NULL DEFAULT 0,
  observacoes           text[] NOT NULL DEFAULT '{}',
  -- Totais do PDF (preservados) e vigentes (recalculados no ajuste manual).
  proventos_pdf         numeric(12, 2) NOT NULL,
  descontos_pdf         numeric(12, 2) NOT NULL,
  liquido_pdf           numeric(12, 2) NOT NULL,
  proventos             numeric(12, 2) NOT NULL,
  descontos             numeric(12, 2) NOT NULL,
  liquido               numeric(12, 2) NOT NULL,
  status                text NOT NULL DEFAULT 'em_conferencia'
                          CHECK (status IN ('confirmado', 'em_conferencia')),
  divergencias          jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmado_em         timestamptz,
  confirmado_por        uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  confirmado_por_nome   text,
  ajustado_em           timestamptz,
  ajustado_por          uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ajustado_por_nome     text,
  ajuste_observacao     text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (importacao_id, codigo),
  CHECK (status <> 'confirmado' OR confirmado_em IS NOT NULL),
  CHECK (ajustado_em IS NULL OR coalesce(btrim(ajuste_observacao), '') <> '')
);

CREATE INDEX IF NOT EXISTS rh_folha_colaboradores_funcionario_idx
  ON public.rh_folha_colaboradores (funcionario_id);
CREATE INDEX IF NOT EXISTS rh_folha_colaboradores_cpf_idx
  ON public.rh_folha_colaboradores (cpf);

CREATE TABLE IF NOT EXISTS public.rh_folha_rubricas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id  uuid NOT NULL REFERENCES public.rh_folha_colaboradores (id) ON DELETE CASCADE,
  ordem           integer NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('P', 'D')),
  codigo          text NOT NULL DEFAULT '',
  descricao       text NOT NULL,
  referencia      text NOT NULL DEFAULT '',
  valor_hora      text NOT NULL DEFAULT '',
  valor           numeric(12, 2) NOT NULL,
  valor_original  numeric(12, 2),
  origem          text NOT NULL CHECK (origem IN ('pdf', 'manual')),
  removida        boolean NOT NULL DEFAULT false,
  UNIQUE (colaborador_id, ordem),
  CHECK (origem = 'manual' OR valor_original IS NOT NULL),
  CHECK (origem = 'pdf' OR (valor_original IS NULL AND NOT removida))
);

CREATE TABLE IF NOT EXISTS public.rh_folha_eventos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id   uuid NOT NULL REFERENCES public.rh_folha_importacoes (id) ON DELETE RESTRICT,
  colaborador_id  uuid REFERENCES public.rh_folha_colaboradores (id) ON DELETE SET NULL,
  tipo            text NOT NULL CHECK (tipo IN (
                    'importacao', 'reimportacao', 'substituicao', 'retirada', 'confirmacao',
                    'reabertura_conferencia', 'ajuste', 'vinculo', 'fechamento', 'reabertura')),
  -- Retrato do colaborador antes de ser substituído/retirado/ajustado.
  dados           jsonb NOT NULL DEFAULT '{}'::jsonb,
  em              timestamptz NOT NULL DEFAULT now(),
  por             uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  por_nome        text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS rh_folha_eventos_importacao_idx
  ON public.rh_folha_eventos (importacao_id, em);

CREATE TABLE IF NOT EXISTS public.rh_restituicao_inss_marcacoes (
  funcionario_id      uuid PRIMARY KEY REFERENCES public.funcionarios (id) ON DELETE CASCADE,
  recebe              boolean NOT NULL,
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_por      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  atualizado_por_nome text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.rh_restituicao_inss_historico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id  uuid NOT NULL REFERENCES public.funcionarios (id) ON DELETE CASCADE,
  recebe          boolean NOT NULL,
  em              timestamptz NOT NULL DEFAULT now(),
  por             uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  por_nome        text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS rh_restituicao_inss_historico_func_idx
  ON public.rh_restituicao_inss_historico (funcionario_id, em DESC);

CREATE TABLE IF NOT EXISTS public.rh_folha_restituicoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id     uuid NOT NULL REFERENCES public.rh_folha_importacoes (id) ON DELETE RESTRICT,
  colaborador_id    uuid NOT NULL REFERENCES public.rh_folha_colaboradores (id) ON DELETE CASCADE,
  funcionario_id    uuid REFERENCES public.funcionarios (id) ON DELETE SET NULL,
  marcado           boolean NOT NULL,
  valor_inss        numeric(12, 2) NOT NULL CHECK (valor_inss >= 0),
  valor_restituicao numeric(12, 2) NOT NULL CHECK (valor_restituicao >= 0),
  gravado_em        timestamptz NOT NULL DEFAULT now(),
  gravado_por       uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  gravado_por_nome  text NOT NULL DEFAULT '',
  UNIQUE (colaborador_id),
  CHECK (marcado OR valor_restituicao = 0)
);

CREATE INDEX IF NOT EXISTS rh_folha_restituicoes_importacao_idx
  ON public.rh_folha_restituicoes (importacao_id);

-- ── Gravação atômica da importação/reimportação ─────────────────────────────
-- p: { school_id, competencia, empresa, cnpj, cnpj_colegio, cnpj_divergente,
--      total_proventos, total_descontos, liquido_geral, total_colaboradores,
--      por, por_nome, gravar: [colaborador + rubricas], retirar: [codigo] }
-- Colaboradores fora de "gravar" e de "retirar" ficam exatamente como estão.
CREATE OR REPLACE FUNCTION public.rh_folha_gravar_importacao(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imp      uuid;
  v_status   text;
  v_nova     boolean := false;
  v_col      jsonb;
  v_rub      jsonb;
  v_col_id   uuid;
  v_ordem    integer;
  v_por      uuid := nullif(p->>'por', '')::uuid;
  v_por_nome text := coalesce(p->>'por_nome', '');
  v_codigo   text;
BEGIN
  SELECT id, status INTO v_imp, v_status
    FROM public.rh_folha_importacoes
   WHERE school_id = (p->>'school_id')::uuid AND competencia = p->>'competencia'
   FOR UPDATE;

  IF v_imp IS NULL THEN
    v_nova := true;
    INSERT INTO public.rh_folha_importacoes (
      school_id, competencia, empresa, cnpj, cnpj_colegio, cnpj_divergente, calculo,
      total_proventos, total_descontos, liquido_geral, total_colaboradores,
      importado_por, importado_por_nome)
    VALUES (
      (p->>'school_id')::uuid, p->>'competencia', coalesce(p->>'empresa', ''),
      coalesce(p->>'cnpj', ''), coalesce(p->>'cnpj_colegio', ''),
      coalesce((p->>'cnpj_divergente')::boolean, false), 'Folha Mensal',
      (p->>'total_proventos')::numeric, (p->>'total_descontos')::numeric,
      (p->>'liquido_geral')::numeric, (p->>'total_colaboradores')::integer,
      v_por, v_por_nome)
    RETURNING id INTO v_imp;
  ELSE
    IF v_status = 'fechada' THEN
      RAISE EXCEPTION 'Competência fechada: não aceita reimportação.';
    END IF;
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

  FOR v_codigo IN SELECT jsonb_array_elements_text(coalesce(p->'retirar', '[]'::jsonb)) LOOP
    SELECT id INTO v_col_id FROM public.rh_folha_colaboradores
     WHERE importacao_id = v_imp AND codigo = v_codigo;
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
     WHERE importacao_id = v_imp AND codigo = v_col->>'codigo';
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
        tipo = v_col->>'tipo', nome = v_col->>'nome', cpf = coalesce(v_col->>'cpf', ''),
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
-- p: { colaborador_id, observacao, por, por_nome, proventos, descontos, liquido,
--      rubricas: [{ tipo, codigo, descricao, referencia, valor_hora, valor,
--                   valor_original, origem, removida }] }
CREATE OR REPLACE FUNCTION public.rh_folha_ajustar_colaborador(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col      public.rh_folha_colaboradores%ROWTYPE;
  v_status   text;
  v_rub      jsonb;
  v_ordem    integer := 0;
  v_por      uuid := nullif(p->>'por', '')::uuid;
  v_por_nome text := coalesce(p->>'por_nome', '');
BEGIN
  SELECT * INTO v_col FROM public.rh_folha_colaboradores
   WHERE id = (p->>'colaborador_id')::uuid FOR UPDATE;
  IF v_col.id IS NULL THEN RAISE EXCEPTION 'Colaborador não encontrado.'; END IF;
  SELECT status INTO v_status FROM public.rh_folha_importacoes WHERE id = v_col.importacao_id;
  IF v_status = 'fechada' THEN RAISE EXCEPTION 'Competência fechada: somente leitura.'; END IF;
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

ALTER TABLE public.rh_folha_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_folha_colaboradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_folha_rubricas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_folha_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_restituicao_inss_marcacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_restituicao_inss_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_folha_restituicoes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rh_folha_importacoes FROM anon, authenticated;
REVOKE ALL ON public.rh_folha_colaboradores FROM anon, authenticated;
REVOKE ALL ON public.rh_folha_rubricas FROM anon, authenticated;
REVOKE ALL ON public.rh_folha_eventos FROM anon, authenticated;
REVOKE ALL ON public.rh_restituicao_inss_marcacoes FROM anon, authenticated;
REVOKE ALL ON public.rh_restituicao_inss_historico FROM anon, authenticated;
REVOKE ALL ON public.rh_folha_restituicoes FROM anon, authenticated;

GRANT ALL ON public.rh_folha_importacoes TO service_role;
GRANT ALL ON public.rh_folha_colaboradores TO service_role;
GRANT ALL ON public.rh_folha_rubricas TO service_role;
GRANT ALL ON public.rh_folha_eventos TO service_role;
GRANT ALL ON public.rh_restituicao_inss_marcacoes TO service_role;
GRANT ALL ON public.rh_restituicao_inss_historico TO service_role;
GRANT ALL ON public.rh_folha_restituicoes TO service_role;

REVOKE ALL ON FUNCTION public.rh_folha_gravar_importacao(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rh_folha_ajustar_colaborador(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_folha_gravar_importacao(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rh_folha_ajustar_colaborador(jsonb) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
