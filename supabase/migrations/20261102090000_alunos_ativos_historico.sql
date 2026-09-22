-- Histórico mensal de alunos matriculados ativos por unidade.
-- Gravado pelo cron /api/alunos-ativos/cron no último dia de cada mês, a partir
-- de diario_matriculas_ano (ano vigente, ativo=true). Upsert por school_id + ano_mes.

CREATE TABLE IF NOT EXISTS public.alunos_ativos_historico (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_mes       text NOT NULL CHECK (ano_mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  total_alunos  integer NOT NULL CHECK (total_alunos >= 0),
  capturado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, ano_mes)
);

CREATE INDEX IF NOT EXISTS alunos_ativos_historico_ano_mes_idx
  ON public.alunos_ativos_historico (ano_mes);

ALTER TABLE public.alunos_ativos_historico ENABLE ROW LEVEL SECURITY;

-- Escrita só pelo servidor (cron, service role); leitura pelo Dashboard via
-- server function (service role, RBAC por unidade no servidor).
REVOKE ALL ON public.alunos_ativos_historico FROM anon, authenticated;
GRANT ALL ON public.alunos_ativos_historico TO service_role;
