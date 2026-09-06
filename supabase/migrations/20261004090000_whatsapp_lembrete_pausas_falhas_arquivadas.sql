-- Mensagens Automáticas: pausa manual dos lembretes preventivos por número e
-- arquivamento visual das falhas de entrega.

-- ── Pausa manual dos lembretes preventivos (D-5/D-3/D-0) ─────────────────────
-- Sem prazo: vale até alguém reativar (apagar a linha). Só a régua de lembretes
-- consulta esta tabela; cobrança de parcela vencida, lembrete de rematrícula e
-- demais automações ignoram-na. Não confundir com whatsapp_billing_pauses
-- (24h por comprovante, cobrança E lembrete).
CREATE TABLE IF NOT EXISTS public.whatsapp_lembrete_pausas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone text NOT NULL,
  responsavel_nome text NOT NULL DEFAULT '',
  alunos_nomes text NOT NULL DEFAULT '',
  unidade text NOT NULL DEFAULT '',
  nota text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT ''
);

-- Um número pausado uma única vez (chave = últimos 8 dígitos, como no cron).
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_lembrete_pausas_chave_idx
  ON public.whatsapp_lembrete_pausas (right(regexp_replace(telefone, '\D', '', 'g'), 8));

ALTER TABLE public.whatsapp_lembrete_pausas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view whatsapp_lembrete_pausas" ON public.whatsapp_lembrete_pausas;
CREATE POLICY "view whatsapp_lembrete_pausas"
  ON public.whatsapp_lembrete_pausas
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'financeiro_cobranca'::public.app_module));

DROP POLICY IF EXISTS "insert whatsapp_lembrete_pausas" ON public.whatsapp_lembrete_pausas;
CREATE POLICY "insert whatsapp_lembrete_pausas"
  ON public.whatsapp_lembrete_pausas
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module));

DROP POLICY IF EXISTS "delete whatsapp_lembrete_pausas" ON public.whatsapp_lembrete_pausas;
CREATE POLICY "delete whatsapp_lembrete_pausas"
  ON public.whatsapp_lembrete_pausas
  FOR DELETE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module));

-- ── Falhas de entrega arquivadas ─────────────────────────────────────────────
-- Limpeza só de visualização: nenhum registro de whatsapp_billing_logs é
-- apagado. Guarda, por chave da linha (telefone ou nome+unidade), até que
-- tentativa a falha foi arquivada. Uma falha posterior a `ate` reaparece.
CREATE TABLE IF NOT EXISTS public.whatsapp_falhas_arquivadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL,
  ate timestamptz NOT NULL,
  responsavel_nome text NOT NULL DEFAULT '',
  telefone text NOT NULL DEFAULT '',
  unidade text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS whatsapp_falhas_arquivadas_chave_idx
  ON public.whatsapp_falhas_arquivadas (chave, ate DESC);

ALTER TABLE public.whatsapp_falhas_arquivadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view whatsapp_falhas_arquivadas" ON public.whatsapp_falhas_arquivadas;
CREATE POLICY "view whatsapp_falhas_arquivadas"
  ON public.whatsapp_falhas_arquivadas
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'financeiro_cobranca'::public.app_module));

DROP POLICY IF EXISTS "insert whatsapp_falhas_arquivadas" ON public.whatsapp_falhas_arquivadas;
CREATE POLICY "insert whatsapp_falhas_arquivadas"
  ON public.whatsapp_falhas_arquivadas
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module));

NOTIFY pgrst, 'reload schema';
