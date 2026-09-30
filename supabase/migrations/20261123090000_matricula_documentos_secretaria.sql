-- Documentos anexados pela secretaria na ficha da matrícula (tela Matrículas /
-- e-Formulário), para arquivos que a família mandou depois do envio (ex.:
-- WhatsApp). O arquivo vai para o mesmo bucket privado matricula-documentos e
-- a linha para matricula_documentos, com a mesma submission_id e o mesmo
-- sponte_aluno_id da submissão: quem já lê os documentos do aluno (ex.:
-- Cobrança) passa a ver o anexo sem mudança. O payload da submissão não muda.
--
-- origem: 'familia' (formulário) ou 'secretaria' (anexado na ficha).
-- nome_documento: nome livre dos arquivos fora da lista do formulário.
-- anexado_por / anexado_por_nome: quem anexou (só secretaria).
--
-- Substituir um documento guarda a versão anterior em
-- matricula_documentos_historico (o arquivo continua no bucket).
-- matricula_documentos continua com UMA linha atual por (submission_id,
-- documento); por isso a UNIQUE existente é mantida. Anexos de nome livre
-- usam documento = 'outro_<uuid>'.
--
-- Só aditiva: as linhas existentes vieram do formulário e ficam com
-- origem = 'familia' pelo valor padrão; nada mais é alterado.

BEGIN;

ALTER TABLE public.matricula_documentos
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'familia',
  ADD COLUMN IF NOT EXISTS nome_documento text,
  ADD COLUMN IF NOT EXISTS anexado_por uuid,
  ADD COLUMN IF NOT EXISTS anexado_por_nome text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matricula_documentos_origem_check'
      AND conrelid = 'public.matricula_documentos'::regclass
  ) THEN
    ALTER TABLE public.matricula_documentos
      ADD CONSTRAINT matricula_documentos_origem_check
      CHECK (origem IN ('familia', 'secretaria'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.matricula_documentos_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Linha de matricula_documentos que recebeu o arquivo novo.
  documento_id uuid,
  submission_id text NOT NULL,
  unidade text NOT NULL,
  sponte_aluno_id integer,
  documento text NOT NULL,
  nome_documento text,
  storage_path text NOT NULL,
  nome_arquivo text NOT NULL,
  tipo_arquivo text NOT NULL,
  tamanho_bytes bigint NOT NULL,
  origem text NOT NULL,
  anexado_por uuid,
  anexado_por_nome text,
  anexado_em timestamptz NOT NULL,
  substituido_em timestamptz NOT NULL DEFAULT now(),
  substituido_por uuid,
  substituido_por_nome text
);

CREATE INDEX IF NOT EXISTS matricula_documentos_historico_submission_idx
  ON public.matricula_documentos_historico (submission_id);

-- Escrita só pelo servidor (service role), depois de checar Editar no
-- e-Formulário.
ALTER TABLE public.matricula_documentos_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eformulario view matricula_documentos_historico"
  ON public.matricula_documentos_historico;
CREATE POLICY "eformulario view matricula_documentos_historico"
  ON public.matricula_documentos_historico
  FOR SELECT TO authenticated
  USING (public.can_view_pagina(auth.uid(), 'eformulario'));

COMMIT;

NOTIFY pgrst, 'reload schema';
