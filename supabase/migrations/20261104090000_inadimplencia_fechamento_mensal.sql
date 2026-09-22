-- Fechamento mensal MANUAL da inadimplência por unidade (botão no Dashboard,
-- após o retorno bancário do dia 01). Guarda só valores em R$ e contagens; os
-- percentuais são calculados no código a partir dos valores, para o consolidado
-- "Todas as Unidades" somar R$ e nunca fazer média de percentuais.
-- Upsert por school_id + ano_mes. Sem cron.

CREATE TABLE IF NOT EXISTS public.inadimplencia_fechamento_mensal (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id               uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_mes                 text NOT NULL CHECK (ano_mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  inadimplente_mes        numeric(14,2) NOT NULL CHECK (inadimplente_mes >= 0),
  faturamento_mes         numeric(14,2) NOT NULL CHECK (faturamento_mes >= 0),
  inadimplente_acumulado  numeric(14,2) NOT NULL CHECK (inadimplente_acumulado >= 0),
  faturamento_acumulado   numeric(14,2) NOT NULL CHECK (faturamento_acumulado >= 0),
  boletos_mes             integer NOT NULL CHECK (boletos_mes >= 0),
  boletos_acumulado       integer NOT NULL CHECK (boletos_acumulado >= 0),
  fechado_por             uuid NOT NULL,
  fechado_em              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, ano_mes)
);

CREATE INDEX IF NOT EXISTS inadimplencia_fechamento_mensal_ano_mes_idx
  ON public.inadimplencia_fechamento_mensal (ano_mes);

ALTER TABLE public.inadimplencia_fechamento_mensal ENABLE ROW LEVEL SECURITY;

-- Leitura e escrita só pelo servidor (server functions com service role; RBAC
-- por unidade e papel admin validados no servidor), igual a alunos_ativos_historico.
REVOKE ALL ON public.inadimplencia_fechamento_mensal FROM anon, authenticated;
GRANT ALL ON public.inadimplencia_fechamento_mensal TO service_role;
