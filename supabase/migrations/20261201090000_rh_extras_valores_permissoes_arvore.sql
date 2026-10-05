-- RH: cadastro "Extras" (RH > Pessoal > Extras) e valor mensal de Terceirizados
-- e Extras (RH > Pagamentos > Salário). Migration ADITIVA: só cria o valor novo
-- do enum e duas tabelas; não altera tabelas, funções ou dados existentes.
--
--   app_module                 nova página rh.pessoal.extras
--                              (sem cópia de acesso: começa só com admin)
--   rh_extras                  pessoas avulsas por colégio; "Remover" inativa
--   rh_pagamentos_valores      valor mensal por tipo × pessoa × competência;
--                              vale a partir da competência até o próximo
--                              registro (valor 0 encerra)
--
-- Acesso SOMENTE pelo servidor (service role): RLS ativo, sem policies,
-- REVOKE de anon/authenticated. As server functions conferem a permissão da
-- página e a unidade do usuário.

BEGIN;

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.pessoal.extras';

-- ── Extras (pessoas avulsas) ────────────────────────────────────────────────
-- nome_chave: nome sem acentos, minúsculo e com espaços simples (calculado no
-- servidor); impede dois Extras ATIVOS com o mesmo nome no mesmo colégio.
CREATE TABLE IF NOT EXISTS public.rh_extras (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  nome_completo       text NOT NULL CHECK (btrim(nome_completo) <> ''),
  nome_chave          text NOT NULL CHECK (nome_chave <> ''),
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  criado_por_nome     text NOT NULL DEFAULT '',
  atualizado_em       timestamptz,
  atualizado_por      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  atualizado_por_nome text,
  inativado_em        timestamptz,
  inativado_por       uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  inativado_por_nome  text
);

CREATE UNIQUE INDEX IF NOT EXISTS rh_extras_nome_ativo_key
  ON public.rh_extras (school_id, nome_chave) WHERE ativo;

ALTER TABLE public.rh_extras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rh_extras FROM anon, authenticated;
GRANT ALL ON public.rh_extras TO service_role;

-- ── Valor mensal de Terceirizados e Extras ──────────────────────────────────
-- pessoa_id aponta para terceirizados.id (tipo 'terceirizado') ou
-- rh_extras.id (tipo 'extra'); o servidor confere a pessoa e o colégio.
CREATE TABLE IF NOT EXISTS public.rh_pagamentos_valores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                text NOT NULL CHECK (tipo IN ('terceirizado', 'extra')),
  pessoa_id           uuid NOT NULL,
  school_id           uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  competencia         text NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  valor               numeric(12, 2) NOT NULL CHECK (valor >= 0),
  observacao          text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  criado_por_nome     text NOT NULL DEFAULT '',
  atualizado_em       timestamptz,
  UNIQUE (tipo, pessoa_id, competencia)
);

CREATE INDEX IF NOT EXISTS rh_pagamentos_valores_school_idx
  ON public.rh_pagamentos_valores (school_id, tipo, competencia DESC);

ALTER TABLE public.rh_pagamentos_valores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rh_pagamentos_valores FROM anon, authenticated;
GRANT ALL ON public.rh_pagamentos_valores TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
