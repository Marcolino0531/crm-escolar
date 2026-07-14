-- Carga inicial/atualização do Diário do Aluno a partir do Sponte + bucket de fotos.
--
-- 1) Identificador externo do aluno no Sponte (AlunoID). Torna a sincronização
--    idempotente: o upsert casa pelo par (school_id, sponte_aluno_id), evitando
--    duplicar alunos a cada execução. Também serve de chave estável para futuras
--    integrações. Índice único parcial (ignora linhas manuais sem sponte_aluno_id).
--
-- 2) Bucket público `diario-fotos` para as fotos dos alunos (resgatadas do
--    Lovable). Público porque a foto é exibida como avatar via URL direta;
--    escrita/edição/remoção exigem can_edit_module('diario').

ALTER TABLE public.diario_students
  ADD COLUMN IF NOT EXISTS sponte_aluno_id text;

CREATE UNIQUE INDEX IF NOT EXISTS diario_students_sponte_uidx
  ON public.diario_students (school_id, sponte_aluno_id)
  WHERE sponte_aluno_id IS NOT NULL;

-- ─── Bucket público de fotos dos alunos ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('diario-fotos', 'diario-fotos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "diario fotos read" ON storage.objects;
DROP POLICY IF EXISTS "diario fotos insert" ON storage.objects;
DROP POLICY IF EXISTS "diario fotos update" ON storage.objects;
DROP POLICY IF EXISTS "diario fotos delete" ON storage.objects;

-- Leitura pública (avatares exibidos por URL direta).
CREATE POLICY "diario fotos read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'diario-fotos');

CREATE POLICY "diario fotos insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'diario-fotos'
    AND public.can_edit_module(auth.uid(), 'diario'::public.app_module)
  );

CREATE POLICY "diario fotos update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'diario-fotos'
    AND public.can_edit_module(auth.uid(), 'diario'::public.app_module)
  )
  WITH CHECK (
    bucket_id = 'diario-fotos'
    AND public.can_edit_module(auth.uid(), 'diario'::public.app_module)
  );

CREATE POLICY "diario fotos delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'diario-fotos'
    AND public.can_edit_module(auth.uid(), 'diario'::public.app_module)
  );
