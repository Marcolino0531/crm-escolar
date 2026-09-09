-- Diário — Fase D: faturamento dos Extras (refeições fora do plano + Hora Extra)
-- no Sponte, no padrão da Cantina: a linha é reivindicada ANTES de falar com o
-- Sponte, o id do título criado fica gravado (nunca lança duas vezes) e existe a
-- saída manual ("lançado manualmente", lancado_automatico = false).

CREATE TABLE IF NOT EXISTS public.diario_faturamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  unidade text NOT NULL,
  student_id uuid NOT NULL REFERENCES public.diario_students (id) ON DELETE CASCADE,
  sponte_aluno_id text NOT NULL,
  aluno_nome text NOT NULL,
  turma text NOT NULL DEFAULT '',
  ano_letivo integer NOT NULL,
  periodo_inicio timestamptz NOT NULL,
  periodo_fim timestamptz NOT NULL,
  -- Composição: [{categoria, rotulo, quantidade, precoUnitario, valor}]
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  valor_total numeric(12, 2) NOT NULL CHECK (valor_total > 0),
  status text NOT NULL DEFAULT 'faturando'
    CHECK (status IN ('faturando', 'erro', 'lancado')),
  sponte_conta_receber_id text,
  sponte_vencimento date,
  sponte_erro text NOT NULL DEFAULT '',
  lancado_at timestamptz,
  lancado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  lancado_por_nome text NOT NULL DEFAULT '',
  lancado_automatico boolean,
  observacao text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT ''
);

-- Um aluno só tem UM faturamento em aberto (faturando/erro) por vez: o INSERT
-- é a reivindicação — quem perde a corrida do clique duplo recebe violação de
-- unicidade e não chega a criar cobrança no Sponte.
CREATE UNIQUE INDEX IF NOT EXISTS diario_faturamentos_aberto_por_aluno_idx
  ON public.diario_faturamentos (student_id)
  WHERE status <> 'lancado';

CREATE INDEX IF NOT EXISTS diario_faturamentos_school_idx
  ON public.diario_faturamentos (school_id, created_at DESC);

-- Evento amarrado ao faturamento que o cobrou; NULL = ainda pendente.
ALTER TABLE public.diario_events
  ADD COLUMN IF NOT EXISTS faturamento_id uuid
    REFERENCES public.diario_faturamentos (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS diario_events_pendentes_idx
  ON public.diario_events (student_id)
  WHERE extra_charge AND faturamento_id IS NULL;

ALTER TABLE public.diario_faturamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "diario view diario_faturamentos" ON public.diario_faturamentos;
CREATE POLICY "diario view diario_faturamentos" ON public.diario_faturamentos
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'diario'::public.app_module));

COMMENT ON TABLE public.diario_faturamentos IS
  'Faturamento dos Extras do Diário (refeições fora do plano + Hora Extra) em título único no Sponte, por aluno e período.';
