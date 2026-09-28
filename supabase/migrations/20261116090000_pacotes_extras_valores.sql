-- Valor Pacotes Extras: pacote mensal (5 dias por semana) de cada refeição e da
-- hora extra, por colégio × ano letivo. Substitui, no faturamento da matrícula
-- nova, o valor avulso por refeição de unidade_valores_opcionais (tabela e dados
-- preservados, deixam apenas de ser lidos pelo fluxo da matrícula).
--
-- Acesso só pelo servidor (server functions com supabaseAdmin): RLS ativo sem
-- policies, REVOKE de anon/authenticated, GRANT só para service_role.
--
-- Só aditiva e idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pacotes_extras_valores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  lanche_manha numeric(12, 2) NOT NULL DEFAULT 0 CHECK (lanche_manha >= 0),
  almoco numeric(12, 2) NOT NULL DEFAULT 0 CHECK (almoco >= 0),
  lanche_tarde numeric(12, 2) NOT NULL DEFAULT 0 CHECK (lanche_tarde >= 0),
  jantar numeric(12, 2) NOT NULL DEFAULT 0 CHECK (jantar >= 0),
  hora_extra numeric(12, 2) NOT NULL DEFAULT 0 CHECK (hora_extra >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT '',
  CONSTRAINT pacotes_extras_valores_unico UNIQUE (unidade, ano_letivo)
);

ALTER TABLE public.pacotes_extras_valores ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pacotes_extras_valores FROM anon, authenticated;
GRANT ALL ON public.pacotes_extras_valores TO service_role;

-- Cada refeição vira um lançamento próprio (idempotência por submission_id ×
-- tipo). O CHECK só é ampliado: os tipos antigos continuam válidos e nenhuma
-- linha existente é alterada.
ALTER TABLE public.matricula_faturamento_lancamentos
  DROP CONSTRAINT IF EXISTS matricula_faturamento_lancamentos_tipo_check;

ALTER TABLE public.matricula_faturamento_lancamentos
  ADD CONSTRAINT matricula_faturamento_lancamentos_tipo_check
  CHECK (
    tipo IN (
      'matricula', 'mensalidade', 'proporcional', 'material', 'alimentacao',
      'lanche_manha', 'almoco', 'lanche_tarde', 'jantar', 'hora_extra'
    )
  );

COMMIT;
