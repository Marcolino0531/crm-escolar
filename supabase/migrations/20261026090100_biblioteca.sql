-- Biblioteca — acervo por colégio, empréstimos e multas internas.
--
-- Cada unidade (school_id) tem o SEU acervo: um mesmo livro no CEC e no
-- Belvedere são títulos e exemplares independentes. A RLS exige o módulo
-- 'biblioteca' E acesso à unidade da linha (can_access_school).
--
-- Modelo:
--   • biblioteca_titulos     → a obra (título, autor, editora, categoria).
--   • biblioteca_exemplares  → uma linha por cópia física, com código de barras
--                              próprio (gerado por sequência, 12 dígitos) e
--                              status: disponivel | emprestado | manutencao | perdido.
--   • biblioteca_emprestimos → um empréstimo por exemplar × aluno. Enquanto
--                              data_devolucao IS NULL o empréstimo está aberto.
--                              A multa por atraso (R$2,00/dia útil, teto R$30,00)
--                              fica gravada na própria linha ao devolver, e é
--                              quitada com multa_paga_em. NADA disto vai para o
--                              Sponte nem para o Extrato Bancário.
--
-- Regras garantidas pelo banco:
--   • 1 empréstimo aberto por exemplar (índice único parcial);
--   • 1 empréstimo aberto por aluno × unidade (índice único parcial).
-- As demais (bloqueio por multa/atraso, exemplar indisponível) ficam na
-- aplicação (src/lib/biblioteca.ts), com testes puros.

CREATE TABLE IF NOT EXISTS public.biblioteca_titulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  titulo text NOT NULL,
  autor text NOT NULL DEFAULT '',
  editora text NOT NULL DEFAULT '',
  categoria text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS biblioteca_titulos_school_idx
  ON public.biblioteca_titulos (school_id, titulo);

CREATE SEQUENCE IF NOT EXISTS public.biblioteca_exemplares_codigo_seq;

CREATE TABLE IF NOT EXISTS public.biblioteca_exemplares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  titulo_id uuid NOT NULL REFERENCES public.biblioteca_titulos (id) ON DELETE CASCADE,
  -- Código de barras impresso na etiqueta (12 dígitos, único em todo o sistema).
  codigo text NOT NULL UNIQUE
    DEFAULT lpad(nextval('public.biblioteca_exemplares_codigo_seq')::text, 12, '0'),
  status text NOT NULL DEFAULT 'disponivel'
    CHECK (status IN ('disponivel', 'emprestado', 'manutencao', 'perdido')),
  observacao text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS biblioteca_exemplares_titulo_idx
  ON public.biblioteca_exemplares (titulo_id);
CREATE INDEX IF NOT EXISTS biblioteca_exemplares_school_status_idx
  ON public.biblioteca_exemplares (school_id, status);

CREATE TABLE IF NOT EXISTS public.biblioteca_emprestimos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  exemplar_id uuid NOT NULL REFERENCES public.biblioteca_exemplares (id) ON DELETE RESTRICT,
  -- AlunoID do Sponte (texto, como nas demais tabelas que apontam para aluno).
  aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  turma text NOT NULL DEFAULT '',
  data_emprestimo date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  data_prevista date NOT NULL,
  -- NULL = em aberto. Preenchida na devolução (ou ao marcar perdido).
  data_devolucao date,
  -- Exemplar não voltou: encerrado como perdido (sem multa em dinheiro).
  perdido boolean NOT NULL DEFAULT false,
  -- Calculados na devolução (dias ÚTEIS de atraso e multa com teto).
  dias_atraso integer NOT NULL DEFAULT 0 CHECK (dias_atraso >= 0),
  multa_valor numeric(8, 2) NOT NULL DEFAULT 0 CHECK (multa_valor >= 0),
  multa_paga_em timestamptz,
  multa_paga_por_nome text NOT NULL DEFAULT '',
  observacao text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT '',
  devolvido_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  devolvido_por_nome text NOT NULL DEFAULT '',
  CONSTRAINT biblioteca_emprestimos_datas_chk
    CHECK (data_prevista >= data_emprestimo AND (data_devolucao IS NULL OR data_devolucao >= data_emprestimo))
);

CREATE UNIQUE INDEX IF NOT EXISTS biblioteca_emprestimos_exemplar_aberto_key
  ON public.biblioteca_emprestimos (exemplar_id) WHERE data_devolucao IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS biblioteca_emprestimos_aluno_aberto_key
  ON public.biblioteca_emprestimos (school_id, aluno_id) WHERE data_devolucao IS NULL;
CREATE INDEX IF NOT EXISTS biblioteca_emprestimos_school_aluno_idx
  ON public.biblioteca_emprestimos (school_id, aluno_id, data_emprestimo DESC);
CREATE INDEX IF NOT EXISTS biblioteca_emprestimos_multa_aberta_idx
  ON public.biblioteca_emprestimos (school_id) WHERE multa_valor > 0 AND multa_paga_em IS NULL;

DROP TRIGGER IF EXISTS biblioteca_titulos_set_updated_at ON public.biblioteca_titulos;
CREATE TRIGGER biblioteca_titulos_set_updated_at BEFORE UPDATE ON public.biblioteca_titulos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS biblioteca_exemplares_set_updated_at ON public.biblioteca_exemplares;
CREATE TRIGGER biblioteca_exemplares_set_updated_at BEFORE UPDATE ON public.biblioteca_exemplares
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS biblioteca_emprestimos_set_updated_at ON public.biblioteca_emprestimos;
CREATE TRIGGER biblioteca_emprestimos_set_updated_at BEFORE UPDATE ON public.biblioteca_emprestimos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- RLS: módulo 'biblioteca' + unidade da linha ----------

ALTER TABLE public.biblioteca_titulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biblioteca_exemplares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biblioteca_emprestimos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['biblioteca_titulos', 'biblioteca_exemplares', 'biblioteca_emprestimos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "biblioteca view %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "biblioteca view %s" ON public.%I FOR SELECT TO authenticated USING (public.can_view_module(auth.uid(), ''biblioteca''::public.app_module) AND public.can_access_school(auth.uid(), school_id))',
      t, t);
    EXECUTE format('DROP POLICY IF EXISTS "biblioteca edit %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "biblioteca edit %s" ON public.%I FOR ALL TO authenticated USING (public.can_edit_module(auth.uid(), ''biblioteca''::public.app_module) AND public.can_access_school(auth.uid(), school_id)) WITH CHECK (public.can_edit_module(auth.uid(), ''biblioteca''::public.app_module) AND public.can_access_school(auth.uid(), school_id))',
      t, t);
  END LOOP;
END $$;
