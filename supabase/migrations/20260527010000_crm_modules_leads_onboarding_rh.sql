-- Schooler Hub CRM modules ported into the Supabase stack.
-- Tables: leads (Admissões / Kanban), onboarding (checklist), funcionarios (RH).
-- Multi-tenant by school_id (FK to public.schools). RLS: authenticated users can
-- read/write (school staff use these modules); Financeiro tables keep admin-only
-- writes via their own policies.

-- ---------- Admissões: leads (Kanban) ----------
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  nome_aluno text NOT NULL,
  idade text,
  data_nascimento text,
  turma text,
  nome_pai_mae text,
  telefone text,
  origem text,
  coluna text NOT NULL DEFAULT 'contato-inicial',
  data_visita text,
  horario_visita text,
  motivo_perda text,
  observacao_perda text,
  itens_matricula jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_school_id_idx ON public.leads (school_id);
CREATE INDEX IF NOT EXISTS leads_coluna_idx ON public.leads (coluna);

-- ---------- Onboarding (checklist) ----------
CREATE TABLE IF NOT EXISTS public.onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  nome_aluno text NOT NULL,
  turma text,
  nome_pai_mae text,
  telefone text,
  tarefas jsonb NOT NULL DEFAULT '{}'::jsonb,
  concluido boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_school_id_idx ON public.onboarding (school_id);

-- ---------- RH: funcionarios ----------
CREATE TABLE IF NOT EXISTS public.funcionarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  nome_completo text NOT NULL,
  cpf text,
  data_nascimento date,
  genero text,
  estado_civil text,
  cargo text,
  data_admissao date,
  data_inicio date,
  data_rescisao date,
  horario_trabalho_inicio text,
  horario_trabalho_fim text,
  horario_almoco_inicio text,
  horario_almoco_fim text,
  ferias jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funcionarios_school_id_idx ON public.funcionarios (school_id);

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS onboarding_set_updated_at ON public.onboarding;
CREATE TRIGGER onboarding_set_updated_at BEFORE UPDATE ON public.onboarding
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS funcionarios_set_updated_at ON public.funcionarios;
CREATE TRIGGER funcionarios_set_updated_at BEFORE UPDATE ON public.funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- RLS ----------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all leads" ON public.leads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all onboarding" ON public.onboarding
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all funcionarios" ON public.funcionarios
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
