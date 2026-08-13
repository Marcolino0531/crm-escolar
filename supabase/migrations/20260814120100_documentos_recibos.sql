-- Módulo Documentos — cadastro dos colégios (papel timbrado do recibo) e
-- histórico dos recibos emitidos.
--
-- O recibo guarda um SNAPSHOT completo (dados do colégio, do aluno, do
-- responsável e dos itens) em `snapshot`. É o que permite reimprimir meses
-- depois exatamente o mesmo documento — sem reconsultar o Sponte e sem que uma
-- mudança posterior de endereço, de CNPJ ou de responsável reescreva um recibo
-- já entregue. As colunas soltas (aluno_id, unidade, data_recibo, valor_total)
-- existem para filtrar/somar o histórico sem abrir o JSON.
--
-- Nada aqui é escrito no Sponte: o recibo é documento do colégio, não baixa
-- financeira. O valor de cada tópico é digitado pelo usuário.

-- ── Bucket dos logos (privado; leitura por URL assinada) ──────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "documentos storage read" ON storage.objects;
DROP POLICY IF EXISTS "documentos storage insert" ON storage.objects;
DROP POLICY IF EXISTS "documentos storage update" ON storage.objects;
DROP POLICY IF EXISTS "documentos storage delete" ON storage.objects;

CREATE POLICY "documentos storage read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND public.can_view_module(auth.uid(), 'documentos'::public.app_module)
  );

CREATE POLICY "documentos storage insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos'
    AND public.can_edit_module(auth.uid(), 'documentos'::public.app_module)
  );

CREATE POLICY "documentos storage update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND public.can_edit_module(auth.uid(), 'documentos'::public.app_module)
  )
  WITH CHECK (
    bucket_id = 'documentos'
    AND public.can_edit_module(auth.uid(), 'documentos'::public.app_module)
  );

CREATE POLICY "documentos storage delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND public.can_edit_module(auth.uid(), 'documentos'::public.app_module)
  );

-- ── Cadastro por colégio (uma linha por unidade) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.documentos_colegios (
  unidade text PRIMARY KEY,
  razao_social text NOT NULL DEFAULT '',
  nome_fantasia text NOT NULL DEFAULT '',
  cnpj text NOT NULL DEFAULT '',
  inscricao_municipal text NOT NULL DEFAULT '',
  endereco text NOT NULL DEFAULT '',
  numero text NOT NULL DEFAULT '',
  complemento text NOT NULL DEFAULT '',
  bairro text NOT NULL DEFAULT '',
  cidade text NOT NULL DEFAULT '',
  uf text NOT NULL DEFAULT '',
  cep text NOT NULL DEFAULT '',
  telefone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  site text NOT NULL DEFAULT '',
  -- Quem assina o recibo (nome e cargo impressos sob a linha de assinatura).
  assinante_nome text NOT NULL DEFAULT '',
  assinante_cargo text NOT NULL DEFAULT '',
  -- Texto fixo opcional no pé do recibo (ex.: aviso de imposto de renda).
  observacao text NOT NULL DEFAULT '',
  logo_path text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by_nome text NOT NULL DEFAULT ''
);

DROP TRIGGER IF EXISTS documentos_colegios_set_updated_at ON public.documentos_colegios;
CREATE TRIGGER documentos_colegios_set_updated_at BEFORE UPDATE ON public.documentos_colegios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Histórico de recibos ──────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.documentos_recibos_numero_seq AS bigint START 1;

CREATE TABLE IF NOT EXISTS public.documentos_recibos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Número sequencial impresso no recibo (único, nunca reaproveitado).
  numero bigint NOT NULL DEFAULT nextval('public.documentos_recibos_numero_seq') UNIQUE,
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  responsavel_id text NOT NULL DEFAULT '',
  responsavel_nome text NOT NULL DEFAULT '',
  responsavel_cpf text NOT NULL DEFAULT '',
  -- Data que consta no documento (escolhida pelo usuário, não a de emissão).
  data_recibo date NOT NULL,
  valor_total numeric(12, 2) NOT NULL DEFAULT 0,
  -- Itens preenchidos: [{ "id": "mensalidade", "descricao": "...", "valor": 1200 }].
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Documento inteiro como foi emitido (colégio + aluno + responsável + itens).
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_nome text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS documentos_recibos_aluno_idx
  ON public.documentos_recibos (aluno_id);
CREATE INDEX IF NOT EXISTS documentos_recibos_unidade_data_idx
  ON public.documentos_recibos (unidade, data_recibo DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.documentos_colegios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_recibos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documentos colegios select" ON public.documentos_colegios;
DROP POLICY IF EXISTS "documentos colegios insert" ON public.documentos_colegios;
DROP POLICY IF EXISTS "documentos colegios update" ON public.documentos_colegios;
DROP POLICY IF EXISTS "documentos recibos select" ON public.documentos_recibos;
DROP POLICY IF EXISTS "documentos recibos insert" ON public.documentos_recibos;
DROP POLICY IF EXISTS "documentos recibos delete" ON public.documentos_recibos;

CREATE POLICY "documentos colegios select" ON public.documentos_colegios
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'documentos'::public.app_module));

CREATE POLICY "documentos colegios insert" ON public.documentos_colegios
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'documentos'::public.app_module));

CREATE POLICY "documentos colegios update" ON public.documentos_colegios
  FOR UPDATE TO authenticated
  USING (public.can_edit_module(auth.uid(), 'documentos'::public.app_module))
  WITH CHECK (public.can_edit_module(auth.uid(), 'documentos'::public.app_module));

CREATE POLICY "documentos recibos select" ON public.documentos_recibos
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'documentos'::public.app_module));

CREATE POLICY "documentos recibos insert" ON public.documentos_recibos
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_module(auth.uid(), 'documentos'::public.app_module));

-- Recibo entregue ao responsável é registro contábil: não se apaga da história.
-- Sem policy de DELETE (nem de UPDATE) — só admin, via service role.
