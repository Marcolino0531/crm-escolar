-- RH > Pagamentos > Salário: excluir um colaborador da Folha de Pagamento depois
-- da importação (só admin). Migration ADITIVA: não apaga nem altera dados.
--
--   rh_folha_exclusoes             exclusões por competência (empresa × tipo × código)
--                                  e fixas do colégio (por CPF; sem CPF, por
--                                  empresa × tipo × código). Guarda só a identidade,
--                                  o motivo, quem e quando: nenhum valor nem rubrica.
--   rh_folha_excluir_colaborador   apaga o registro da folha gravada (rubricas,
--                                  restituição e eventos anteriores dele) e grava a
--                                  exclusão, tudo numa transação.
--
-- Acesso SOMENTE pelo servidor (service role): RLS ativo, sem policies,
-- REVOKE de anon/authenticated.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rh_folha_exclusoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  fixa               boolean NOT NULL DEFAULT false,
  -- NULL nas fixas (valem para todas as próximas importações do colégio).
  competencia        text CHECK (competencia IS NULL OR competencia ~ '^\d{4}-\d{2}$'),
  cnpj               text NOT NULL DEFAULT '',
  tipo               text NOT NULL CHECK (tipo IN ('empregado', 'contribuinte')),
  codigo             text NOT NULL,
  cpf                text NOT NULL DEFAULT '',
  nome               text NOT NULL DEFAULT '',
  motivo             text NOT NULL CHECK (btrim(motivo) <> ''),
  excluido_em        timestamptz NOT NULL DEFAULT now(),
  excluido_por       uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  excluido_por_nome  text NOT NULL DEFAULT '',
  CHECK ((fixa AND competencia IS NULL) OR (NOT fixa AND competencia IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS rh_folha_exclusoes_competencia_key
  ON public.rh_folha_exclusoes
     (school_id, competencia, (regexp_replace(cnpj, '\D', '', 'g')), tipo, codigo)
  WHERE NOT fixa;

CREATE UNIQUE INDEX IF NOT EXISTS rh_folha_exclusoes_fixa_cpf_key
  ON public.rh_folha_exclusoes (school_id, cpf)
  WHERE fixa AND cpf <> '';

CREATE UNIQUE INDEX IF NOT EXISTS rh_folha_exclusoes_fixa_codigo_key
  ON public.rh_folha_exclusoes (school_id, (regexp_replace(cnpj, '\D', '', 'g')), tipo, codigo)
  WHERE fixa AND cpf = '';

-- ── Eventos: tipos 'exclusao' e 'exclusao_desfeita' ─────────────────────────
-- Remove o CHECK atual de rh_folha_eventos.tipo (localizado pela definição, só
-- na coluna tipo) e recria com a lista anterior + os dois tipos novos.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.rh_folha_eventos'::regclass
       AND c.contype = 'c'
       AND (SELECT array_agg(a.attname::text)
              FROM unnest(c.conkey) AS k(attnum)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
           = ARRAY['tipo']
  LOOP
    EXECUTE format('ALTER TABLE public.rh_folha_eventos DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.rh_folha_eventos
  ADD CONSTRAINT rh_folha_eventos_tipo_check CHECK (tipo IN (
    'importacao', 'reimportacao', 'substituicao', 'retirada', 'confirmacao',
    'reabertura_conferencia', 'ajuste', 'vinculo', 'fechamento', 'reabertura',
    'exclusao', 'exclusao_desfeita'));

ALTER TABLE public.rh_folha_exclusoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rh_folha_exclusoes FROM anon, authenticated;
GRANT ALL ON public.rh_folha_exclusoes TO service_role;

-- ── Exclusão atômica de um registro da folha ────────────────────────────────
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
    excluido_por, excluido_por_nome)
  VALUES (
    v_school, false, v_comp, v_col.cnpj, v_col.tipo, v_col.codigo, v_col.cpf, v_col.nome,
    v_motivo, v_por, v_por_nome)
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

COMMIT;

NOTIFY pgrst, 'reload schema';
