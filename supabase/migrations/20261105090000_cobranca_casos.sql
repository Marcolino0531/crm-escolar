-- Cobrança: régua MANUAL por responsável financeiro (casos, 5 mensagens com
-- print, notificação extrajudicial, documentação para o processo e dossiê).
-- Substitui a régua automática antiga (perfis D+2..D+60 + checklist do dia 25).
--
-- Contagem em produção antes do DROP (2026-09-19):
--   cobranca_envios    = 39 linhas
--   cobranca_checklist =  3 linhas
-- Histórico descartado por decisão do Sérgio (a aba "Histórico de Envios" da
-- tela continua lendo whatsapp_billing_logs, que NÃO é tocada aqui).

-- ─── Tabelas antigas ─────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.cobranca_envios;
DROP TABLE IF EXISTS public.cobranca_checklist;

-- ─── Casos ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranca_casos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  -- CPF só dígitos; se o Sponte não tiver CPF, nome normalizado.
  responsavel_key text NOT NULL,
  responsavel_nome text NOT NULL,
  responsavel_cpf text,
  responsavel_telefone text,
  responsavel_email text,
  -- { endereco, numero, complemento, bairro, cidade, estado, cep } como vem do Sponte.
  responsavel_endereco jsonb,
  -- [{ aluno_id, nome }]
  alunos jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Snapshot das parcelas vencidas no início:
  -- [{ aluno_id, aluno, descricao, vencimento, original, dias_atraso, multa, juros, atualizado }]
  debito_inicial jsonb NOT NULL DEFAULT '[]'::jsonb,
  valor_inicial numeric(14,2) NOT NULL CHECK (valor_inicial >= 0),
  status text NOT NULL DEFAULT 'mensagens'
    CHECK (status IN ('mensagens','notificacao','aguardando_prazo','processo','encerrado')),
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_por uuid NOT NULL,
  notificacao_gerada_em timestamptz,
  notificacao_recebida_em date,
  -- notificacao_recebida_em + 10 dias corridos
  prazo_final date,
  -- Itens do checklist de documentação marcados como concluídos (categorias).
  documentacao_concluida jsonb NOT NULL DEFAULT '[]'::jsonb,
  encerrado_em timestamptz,
  encerrado_por uuid,
  motivo_encerramento text
    CHECK (motivo_encerramento IS NULL
      OR motivo_encerramento IN ('pago','acordo','extinto','incobravel','outro')),
  observacao_encerramento text,
  CONSTRAINT cobranca_casos_encerramento_coerente CHECK (
    (status = 'encerrado') = (encerrado_em IS NOT NULL AND motivo_encerramento IS NOT NULL)
  )
);

-- Um único caso ativo por responsável e unidade.
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_casos_ativo_unico
  ON public.cobranca_casos (unidade, responsavel_key)
  WHERE status <> 'encerrado';

CREATE INDEX IF NOT EXISTS cobranca_casos_unidade_status_idx
  ON public.cobranca_casos (unidade, status, iniciado_em DESC);

-- ─── Mensagens (5 por caso) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranca_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id uuid NOT NULL REFERENCES public.cobranca_casos (id) ON DELETE CASCADE,
  ordem integer NOT NULL CHECK (ordem BETWEEN 1 AND 5),
  data_prevista date NOT NULL,
  enviada_em timestamptz,
  enviada_por uuid,
  print_path text,
  fora_da_data boolean NOT NULL DEFAULT false,
  UNIQUE (caso_id, ordem)
);

-- ─── Anexos ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranca_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id uuid NOT NULL REFERENCES public.cobranca_casos (id) ON DELETE CASCADE,
  categoria text NOT NULL CHECK (categoria IN (
    'notificacao_enviada','print_notificacao','contrato','ficha_matricula',
    'demonstrativo','prestacao_servico','transferencia','docs_responsavel','outro'
  )),
  nome_personalizado text,
  storage_path text NOT NULL,
  nome_arquivo text NOT NULL,
  tipo_arquivo text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes >= 0),
  origem text NOT NULL DEFAULT 'upload' CHECK (origem IN ('upload','sistema','gerado')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cobranca_anexos_caso_idx
  ON public.cobranca_anexos (caso_id, created_at);

-- ─── RLS (padrão do financeiro_cobranca) ─────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cobranca_casos', 'cobranca_mensagens', 'cobranca_anexos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "cobranca view %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "cobranca insert %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "cobranca update %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "cobranca delete %s" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "cobranca view %s" ON public.%I
      FOR SELECT TO authenticated
      USING (public.can_view_module(auth.uid(), 'financeiro_cobranca'::public.app_module))
    $p$, t, t);
    EXECUTE format($p$
      CREATE POLICY "cobranca insert %s" ON public.%I
      FOR INSERT TO authenticated
      WITH CHECK (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module))
    $p$, t, t);
    EXECUTE format($p$
      CREATE POLICY "cobranca update %s" ON public.%I
      FOR UPDATE TO authenticated
      USING (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module))
      WITH CHECK (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module))
    $p$, t, t);
    EXECUTE format($p$
      CREATE POLICY "cobranca delete %s" ON public.%I
      FOR DELETE TO authenticated
      USING (public.can_edit_module(auth.uid(), 'financeiro_cobranca'::public.app_module))
    $p$, t, t);
  END LOOP;
END $$;

-- ─── Bucket privado ──────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cobranca-casos',
  'cobranca-casos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura por link assinado emitido no servidor; upload por URL assinada.
-- A leitura direta fica restrita a quem enxerga a Cobrança.
DROP POLICY IF EXISTS "cobranca casos read" ON storage.objects;
CREATE POLICY "cobranca casos read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cobranca-casos'
    AND public.can_view_module(auth.uid(), 'financeiro_cobranca'::public.app_module)
  );

NOTIFY pgrst, 'reload schema';
