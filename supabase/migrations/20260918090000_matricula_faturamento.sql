-- Fase 3 do fluxo matrícula → turma → faturamento: escolha do parcelamento do
-- material no formulário público, valores opcionais por unidade (refeição e
-- hora extra) e log auditável de cada lançamento gerado no Sponte.

-- ── Escolha do material feita pelo responsável no formulário ───────────────
ALTER TABLE public.enrollment_submissions
  ADD COLUMN IF NOT EXISTS material_parcelas integer,
  ADD COLUMN IF NOT EXISTS material_valor_anual numeric(12, 2),
  ADD COLUMN IF NOT EXISTS faturamento_status text,
  ADD COLUMN IF NOT EXISTS faturamento_pendencia text;

ALTER TABLE public.enrollment_submissions
  DROP CONSTRAINT IF EXISTS enrollment_submissions_material_parcelas_check;

ALTER TABLE public.enrollment_submissions
  ADD CONSTRAINT enrollment_submissions_material_parcelas_check
  CHECK (material_parcelas IS NULL OR material_parcelas BETWEEN 1 AND 8);

ALTER TABLE public.enrollment_submissions
  DROP CONSTRAINT IF EXISTS enrollment_submissions_faturamento_status_check;

ALTER TABLE public.enrollment_submissions
  ADD CONSTRAINT enrollment_submissions_faturamento_status_check
  CHECK (
    faturamento_status IS NULL
    OR faturamento_status IN ('lancado', 'parcial', 'sem_plano', 'erro', 'nao_aplicavel')
  );

-- ── Valores que o Sponte não tem estruturados, por unidade ─────────────────
CREATE TABLE IF NOT EXISTS public.unidade_valores_opcionais (
  unidade text PRIMARY KEY,
  valor_refeicao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor_refeicao >= 0),
  valor_hora_extra numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor_hora_extra >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

-- ── Log de auditoria: uma linha por título do faturamento da matrícula ─────
-- A unicidade (submission_id, tipo) é a trava de idempotência: o retry reusa a
-- linha e nunca gera um segundo InsertPlano do mesmo tipo.
CREATE TABLE IF NOT EXISTS public.matricula_faturamento_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text NOT NULL,
  unidade text NOT NULL,
  sponte_aluno_id text NOT NULL DEFAULT '',
  tipo text NOT NULL,
  categoria text NOT NULL DEFAULT '',
  parcelas integer NOT NULL DEFAULT 1,
  valor_parcela numeric(12, 2) NOT NULL DEFAULT 0,
  valor_primeira_parcela numeric(12, 2) NOT NULL DEFAULT 0,
  primeiro_vencimento date,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  observacao text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pendente',
  sponte_conta_receber_id text,
  retorno_operacao text,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.matricula_faturamento_lancamentos
  DROP CONSTRAINT IF EXISTS matricula_faturamento_lancamentos_tipo_check;

ALTER TABLE public.matricula_faturamento_lancamentos
  ADD CONSTRAINT matricula_faturamento_lancamentos_tipo_check
  CHECK (
    tipo IN ('matricula', 'mensalidade', 'proporcional', 'material', 'alimentacao', 'hora_extra')
  );

ALTER TABLE public.matricula_faturamento_lancamentos
  DROP CONSTRAINT IF EXISTS matricula_faturamento_lancamentos_status_check;

-- `ajuste_pendente` = o título existe no Sponte, mas o UpdateParcela da 1ª
-- parcela falhou: a sobra de centavos precisa de correção manual. O título
-- NUNCA é recriado nesse estado.
ALTER TABLE public.matricula_faturamento_lancamentos
  ADD CONSTRAINT matricula_faturamento_lancamentos_status_check
  CHECK (status IN ('pendente', 'lancado', 'ajuste_pendente', 'erro'));

CREATE UNIQUE INDEX IF NOT EXISTS matricula_faturamento_lancamentos_unico_idx
  ON public.matricula_faturamento_lancamentos (submission_id, tipo);

CREATE INDEX IF NOT EXISTS matricula_faturamento_lancamentos_status_idx
  ON public.matricula_faturamento_lancamentos (status);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.unidade_valores_opcionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matricula_faturamento_lancamentos ENABLE ROW LEVEL SECURITY;

-- Escrita só pela service role (server functions), como nas demais tabelas do
-- fluxo público: a tela de configuração grava por server function autenticada.
DROP POLICY IF EXISTS unidade_valores_opcionais_select ON public.unidade_valores_opcionais;
CREATE POLICY unidade_valores_opcionais_select ON public.unidade_valores_opcionais
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'admissoes'::public.app_module));

DROP POLICY IF EXISTS matricula_faturamento_lancamentos_select
  ON public.matricula_faturamento_lancamentos;
CREATE POLICY matricula_faturamento_lancamentos_select
  ON public.matricula_faturamento_lancamentos
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'admissoes'::public.app_module));
