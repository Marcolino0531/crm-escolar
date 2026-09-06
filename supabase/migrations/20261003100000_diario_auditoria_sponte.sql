-- Auditoria Plano do Diário do Aluno × lançamentos do Sponte.
-- Uma execução por unidade/ano letivo (substituída a cada rodada); só os
-- alunos com inconsistência (ou cuja consulta ao Sponte falhou) são gravados.

CREATE TABLE IF NOT EXISTS public.diario_auditoria_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL CHECK (ano_letivo BETWEEN 2024 AND 2100),
  executada_em timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL DEFAULT 'manual', -- manual | cron
  alunos_auditados integer NOT NULL DEFAULT 0,
  alunos_com_inconsistencia integer NOT NULL DEFAULT 0,
  alunos_com_erro integer NOT NULL DEFAULT 0,
  erro text,
  UNIQUE (school_id, ano_letivo)
);

CREATE TABLE IF NOT EXISTS public.diario_auditoria_inconsistencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id uuid NOT NULL REFERENCES public.diario_auditoria_execucoes (id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  ano_letivo integer NOT NULL,
  student_id uuid NOT NULL REFERENCES public.diario_students (id) ON DELETE CASCADE,
  sponte_aluno_id text NOT NULL,
  aluno_nome text NOT NULL,
  turma text NOT NULL DEFAULT '',
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diario_auditoria_inconsistencias_school_ano_idx
  ON public.diario_auditoria_inconsistencias (school_id, ano_letivo);

ALTER TABLE public.diario_auditoria_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diario_auditoria_inconsistencias ENABLE ROW LEVEL SECURITY;

-- Escrita só pelo servidor (service role). Leitura pela permissão do Diário.
DROP POLICY IF EXISTS "diario view diario_auditoria_execucoes" ON public.diario_auditoria_execucoes;
CREATE POLICY "diario view diario_auditoria_execucoes" ON public.diario_auditoria_execucoes
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'diario'::public.app_module));

DROP POLICY IF EXISTS "diario view diario_auditoria_inconsistencias" ON public.diario_auditoria_inconsistencias;
CREATE POLICY "diario view diario_auditoria_inconsistencias" ON public.diario_auditoria_inconsistencias
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'diario'::public.app_module));
