-- Matrícula pública: série calculada, novo modelo de horários, questionário de
-- saúde e documentos anexados. Também abre a rotina para a Rematrícula.
--
-- Nada aqui vai para o Sponte (a API não tem campos correspondentes): são dados
-- locais do School Hub, lidos no painel interno de Matrículas por quem enxerga
-- o módulo Admissões. A escrita é exclusiva dos formulários públicos, que rodam
-- com service role (ignora RLS).
--
-- Documentos ficam num bucket PRIVADO: o painel abre cada arquivo por link
-- assinado de curta duração, gerado no servidor após checar a permissão.

-- ─── Rotina: série, períodos e origem (matrícula × rematrícula) ──────────────

ALTER TABLE public.student_routine
  ADD COLUMN IF NOT EXISTS serie text,
  ADD COLUMN IF NOT EXISTS periodo_manha boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS periodo_tarde boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS horario_estendido boolean NOT NULL DEFAULT false,
  -- 'matricula' (formulário novo) ou 'rematricula' (atualização anual).
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'matricula',
  -- Ano letivo a que a rotina se refere (usado pela Rematrícula).
  ADD COLUMN IF NOT EXISTS ano_letivo integer;

-- ─── Questionário de saúde ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.matricula_saude (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text NOT NULL UNIQUE,
  unidade text NOT NULL,
  sponte_aluno_id integer,
  aluno_nome text NOT NULL,
  serie text,
  contato_emergencia text NOT NULL,
  alergia text NOT NULL,
  alergia_detalhe text NOT NULL DEFAULT '',
  problema_saude text NOT NULL,
  problema_saude_detalhe text NOT NULL DEFAULT '',
  medicamento_continuo text NOT NULL,
  medicamento_continuo_detalhe text NOT NULL DEFAULT '',
  plano_saude text NOT NULL,
  plano_saude_detalhe text NOT NULL DEFAULT '',
  pessoas_autorizadas text NOT NULL,
  cor_raca text NOT NULL,
  outras_informacoes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS matricula_saude_set_updated_at ON public.matricula_saude;
CREATE TRIGGER matricula_saude_set_updated_at BEFORE UPDATE ON public.matricula_saude
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.matricula_saude ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admissoes view matricula_saude" ON public.matricula_saude;
CREATE POLICY "admissoes view matricula_saude"
  ON public.matricula_saude
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'admissoes'::public.app_module));

-- ─── Documentos anexados (metadata; o arquivo vive no bucket privado) ────────

CREATE TABLE IF NOT EXISTS public.matricula_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text NOT NULL,
  unidade text NOT NULL,
  sponte_aluno_id integer,
  documento text NOT NULL,
  storage_path text NOT NULL,
  nome_arquivo text NOT NULL,
  tipo_arquivo text NOT NULL,
  tamanho_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, documento)
);

CREATE INDEX IF NOT EXISTS matricula_documentos_submission_idx
  ON public.matricula_documentos (submission_id);

ALTER TABLE public.matricula_documentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admissoes view matricula_documentos" ON public.matricula_documentos;
CREATE POLICY "admissoes view matricula_documentos"
  ON public.matricula_documentos
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'admissoes'::public.app_module));

-- ─── Limite de uploads por IP (a URL assinada é emitida sem autenticação) ────

CREATE TABLE IF NOT EXISTS public.matricula_upload_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 do IP; o endereço nunca é gravado em texto.
  ip_hash text NOT NULL,
  documento text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matricula_upload_pedidos_ip_idx
  ON public.matricula_upload_pedidos (ip_hash, created_at DESC);

-- Sem policy: só o formulário público (service role) escreve e ninguém lê pelo
-- cliente.
ALTER TABLE public.matricula_upload_pedidos ENABLE ROW LEVEL SECURITY;

-- ─── Bucket privado dos documentos ──────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'matricula-documentos',
  'matricula-documentos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "matricula documentos read" ON storage.objects;

-- Leitura direta só para quem enxerga Admissões; o responsável nunca lê o
-- bucket (o upload é feito por URL assinada de uso único).
CREATE POLICY "matricula documentos read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'matricula-documentos'
    AND public.can_view_module(auth.uid(), 'admissoes'::public.app_module)
  );

NOTIFY pgrst, 'reload schema';
