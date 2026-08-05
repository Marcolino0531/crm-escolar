-- Planner de tarefas recorrentes, dentro do módulo Tasks.
--
-- Diferente do quadro de tickets (pessoa → pessoa), o Planner trata de tarefas
-- de ROTINA que dependem de DATA (um dia do mês), não de outra pessoa. Ex.:
-- "todo dia 01, enviar o faturamento para a contabilidade".
--
-- Tabelas:
--   • recurring_task_defs         — a definição da rotina (título, dia do mês,
--                                   descrição). Uma linha por rotina, por usuário.
--   • recurring_task_completions  — marca de "cumprida" de UMA ocorrência
--                                   específica (rotina + mês). A recorrência é
--                                   DERIVADA (não materializada): cada mês gera a
--                                   ocorrência no dia configurado; a AUSÊNCIA de
--                                   linha aqui significa "pendente" naquele mês.
--                                   Assim, marcar cumprida em um mês não afeta a
--                                   ocorrência do mês seguinte (nasce pendente).
--
-- PRIVACY: as rotinas são pessoais. RLS restringe cada linha ao seu dono
-- (user_id = auth.uid()), espelhando o isolamento de public.tasks.

-- ---------- Tabelas ----------
CREATE TABLE IF NOT EXISTS public.recurring_task_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  day_of_month int NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recurring_task_defs_user_id_idx
  ON public.recurring_task_defs (user_id);

CREATE TABLE IF NOT EXISTS public.recurring_task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  def_id uuid NOT NULL REFERENCES public.recurring_task_defs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Mês da ocorrência marcada, no formato 'YYYY-MM'.
  month_key text NOT NULL CHECK (month_key ~ '^\d{4}-\d{2}$'),
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (def_id, month_key)
);

CREATE INDEX IF NOT EXISTS recurring_task_completions_user_id_idx
  ON public.recurring_task_completions (user_id);

-- ---------- RLS ----------
ALTER TABLE public.recurring_task_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_completions ENABLE ROW LEVEL SECURITY;

-- recurring_task_defs: o dono lê/gerencia apenas as próprias rotinas.
DROP POLICY IF EXISTS "read own recurring defs" ON public.recurring_task_defs;
CREATE POLICY "read own recurring defs" ON public.recurring_task_defs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "insert own recurring defs" ON public.recurring_task_defs;
CREATE POLICY "insert own recurring defs" ON public.recurring_task_defs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "update own recurring defs" ON public.recurring_task_defs;
CREATE POLICY "update own recurring defs" ON public.recurring_task_defs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "delete own recurring defs" ON public.recurring_task_defs;
CREATE POLICY "delete own recurring defs" ON public.recurring_task_defs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- recurring_task_completions: idem. O usuário marca/desmarca suas ocorrências.
DROP POLICY IF EXISTS "read own recurring completions" ON public.recurring_task_completions;
CREATE POLICY "read own recurring completions" ON public.recurring_task_completions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "insert own recurring completions" ON public.recurring_task_completions;
CREATE POLICY "insert own recurring completions" ON public.recurring_task_completions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "update own recurring completions" ON public.recurring_task_completions;
CREATE POLICY "update own recurring completions" ON public.recurring_task_completions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "delete own recurring completions" ON public.recurring_task_completions;
CREATE POLICY "delete own recurring completions" ON public.recurring_task_completions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public.recurring_task_defs_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recurring_task_defs_touch ON public.recurring_task_defs;
CREATE TRIGGER trg_recurring_task_defs_touch
  BEFORE UPDATE ON public.recurring_task_defs
  FOR EACH ROW
  EXECUTE FUNCTION public.recurring_task_defs_touch();

-- Recarrega o cache de schema do PostgREST para a REST API enxergar as tabelas.
NOTIFY pgrst, 'reload schema';
