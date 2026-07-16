-- Agenda: eventos manuais do tipo "Reunião", lista de colaboradores e
-- normalização de nomes em "Title Case".
--
-- 1) public.title_case(text): formata nomes em Title Case (primeira letra de
--    cada palavra maiúscula), preservando preposições comuns em minúsculo
--    (de, da, do, das, dos, e, di, du) — exceto quando são a 1ª palavra.
-- 2) Trigger em public.leads: aplica title_case em nome_pai_mae, nome_aluno e
--    nos nomes do array JSONB `alunos` a cada INSERT/UPDATE. Backfill dos
--    registros existentes ao final.
-- 3) public.agenda_reunioes: eventos manuais (data/hora, responsável, aluno,
--    colaboradores participantes).
-- 4) public.agenda_colaboradores: lista de referência dos participantes (fonte
--    do multi-select), com seed inicial da equipe.
--
-- RLS (fail-closed): leitura exige can_view_module('agenda'); escrita exige
-- can_edit_module('agenda'). Admin sempre passa (has_role).

-- ─── 1) Função de formatação Title Case ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.title_case(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts text[];
  w text;
  low text;
  out_parts text[] := '{}';
  particles text[] := ARRAY['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du'];
  i int := 0;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;
  parts := regexp_split_to_array(btrim(input), '\s+');
  FOREACH w IN ARRAY parts LOOP
    IF w = '' THEN
      CONTINUE;
    END IF;
    i := i + 1;
    low := lower(w);
    IF i > 1 AND low = ANY(particles) THEN
      out_parts := array_append(out_parts, low);
    ELSE
      out_parts := array_append(out_parts, upper(left(low, 1)) || substr(low, 2));
    END IF;
  END LOOP;
  RETURN array_to_string(out_parts, ' ');
END;
$$;

-- ─── 2) Trigger de normalização de nomes em public.leads ─────────────────────
CREATE OR REPLACE FUNCTION public.leads_format_names()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.nome_pai_mae := public.title_case(NEW.nome_pai_mae);
  NEW.nome_aluno := public.title_case(NEW.nome_aluno);

  -- Formata o campo "nome" de cada objeto do array JSONB `alunos`,
  -- preservando os demais campos e a ordem original.
  IF NEW.alunos IS NOT NULL AND jsonb_typeof(NEW.alunos) = 'array' THEN
    NEW.alunos := COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN jsonb_typeof(elem -> 'nome') = 'string'
              THEN jsonb_set(elem, '{nome}', to_jsonb(public.title_case(elem ->> 'nome')))
            ELSE elem
          END
          ORDER BY ord
        )
        FROM jsonb_array_elements(NEW.alunos) WITH ORDINALITY AS t(elem, ord)
      ),
      NEW.alunos
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_format_names_trg ON public.leads;
CREATE TRIGGER leads_format_names_trg
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_format_names();

-- Backfill: dispara o trigger BEFORE UPDATE em cada linha existente,
-- reformatando nome_pai_mae, nome_aluno e os nomes em `alunos`.
UPDATE public.leads SET nome_pai_mae = nome_pai_mae;

-- ─── 3) Colaboradores (lista de referência do multi-select) ──────────────────
CREATE TABLE IF NOT EXISTS public.agenda_colaboradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nome)
);

ALTER TABLE public.agenda_colaboradores ENABLE ROW LEVEL SECURITY;

-- Seed inicial da equipe (idempotente).
INSERT INTO public.agenda_colaboradores (nome)
VALUES (public.title_case('Franceliza')),
       (public.title_case('Sérgio')),
       (public.title_case('Charline'))
ON CONFLICT (nome) DO NOTHING;

-- ─── 4) Reuniões (eventos manuais da Agenda) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agenda_reunioes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  horario text,
  responsavel_nome text,
  aluno_nome text,
  colaboradores text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agenda_reunioes_data_idx ON public.agenda_reunioes (data);

DROP TRIGGER IF EXISTS agenda_reunioes_set_updated_at ON public.agenda_reunioes;
CREATE TRIGGER agenda_reunioes_set_updated_at
  BEFORE UPDATE ON public.agenda_reunioes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Normaliza os nomes (responsável/aluno) da reunião em Title Case.
CREATE OR REPLACE FUNCTION public.agenda_reunioes_format_names()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.responsavel_nome := public.title_case(NEW.responsavel_nome);
  NEW.aluno_nome := public.title_case(NEW.aluno_nome);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agenda_reunioes_format_names_trg ON public.agenda_reunioes;
CREATE TRIGGER agenda_reunioes_format_names_trg
  BEFORE INSERT OR UPDATE ON public.agenda_reunioes
  FOR EACH ROW EXECUTE FUNCTION public.agenda_reunioes_format_names();

ALTER TABLE public.agenda_reunioes ENABLE ROW LEVEL SECURITY;

-- ─── Policies (idempotentes) ─────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY['agenda_reunioes', 'agenda_colaboradores'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "agenda view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''agenda''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "agenda insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_module(auth.uid(), ''agenda''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "agenda update %s" ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_module(auth.uid(), ''agenda''::public.app_module)) WITH CHECK (public.can_edit_module(auth.uid(), ''agenda''::public.app_module))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "agenda delete %s" ON public.%I FOR DELETE TO authenticated USING (public.can_edit_module(auth.uid(), ''agenda''::public.app_module))',
      t, t);
  END LOOP;
END $$;
