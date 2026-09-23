-- Cobrança manual — controle processual (PR 3).
-- Depende de 20261105090000_cobranca_casos.sql (cobranca_casos, bucket cobranca-casos).
--
-- Um caso em "Pronto para processo" (aguardando_prazo e hoje > prazo_final)
-- vira processo judicial: dados do processo, andamentos (com prazo/audiência
-- opcional), valores recebidos e avisos dispensados dos marcos 5/3/1 dias.
-- Anexos ficam no bucket privado cobranca-casos, na pasta do caso.

-- ─── Processo ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranca_processos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id uuid NOT NULL UNIQUE REFERENCES public.cobranca_casos(id) ON DELETE CASCADE,
  tipo_acao text NOT NULL
    CHECK (tipo_acao IN ('execucao_titulo','monitoria','cobranca','juizado_especial')),
  -- Pode ficar vazio até a distribuição.
  numero_processo text,
  comarca text,
  vara text,
  data_ajuizamento date NOT NULL,
  valor_causa numeric(14,2) NOT NULL CHECK (valor_causa >= 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Andamentos ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranca_andamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES public.cobranca_processos(id) ON DELETE CASCADE,
  data date NOT NULL,
  tipo text NOT NULL
    CHECK (tipo IN ('distribuicao','citacao','audiencia','penhora_bloqueio','acordo',
                    'sentenca','pagamento','arquivamento','outro')),
  descricao text,
  anexo_path text,
  -- Prazo ou audiência futura ligada a este andamento (gera avisos no sino).
  prazo_data date,
  prazo_descricao text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cobranca_andamentos_processo_idx
  ON public.cobranca_andamentos (processo_id, data);
CREATE INDEX IF NOT EXISTS cobranca_andamentos_prazo_idx
  ON public.cobranca_andamentos (prazo_data)
  WHERE prazo_data IS NOT NULL;

-- ─── Recebimentos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranca_recebimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES public.cobranca_processos(id) ON DELETE CASCADE,
  data date NOT NULL,
  tipo text NOT NULL
    CHECK (tipo IN ('parcela_acordo','bloqueio','alvara','pagamento_direto','outro')),
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  observacao text,
  anexo_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cobranca_recebimentos_processo_idx
  ON public.cobranca_recebimentos (processo_id, data);

-- ─── Avisos dispensados (por usuário) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranca_avisos_dispensados (
  andamento_id uuid NOT NULL REFERENCES public.cobranca_andamentos(id) ON DELETE CASCADE,
  marco int NOT NULL CHECK (marco IN (5,3,1)),
  user_id uuid NOT NULL,
  dispensado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (andamento_id, marco, user_id)
);

-- ─── Acesso somente via server functions (padrão de inadimplencia_fechamento_mensal) ──
-- RBAC por unidade é validado no servidor; o navegador não lê nem grava estas tabelas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cobranca_processos', 'cobranca_andamentos',
                           'cobranca_recebimentos', 'cobranca_avisos_dispensados'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
