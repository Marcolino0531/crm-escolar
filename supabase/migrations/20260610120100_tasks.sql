-- Internal task manager ("Tasks") — a Monday-style ticket board where any user
-- can send a task to any other user.
--
-- Tables:
--   • tasks               — one ticket: sender → recipient, with a workflow
--                           status (aberto → em_resolucao → concluido).
--   • task_notifications  — in-app notices. When a recipient marks a task as
--                           "concluido", the original sender gets a notice.
--
-- PRIVACY: RLS restricts every task row to its sender OR recipient. Tasks
-- exchanged between other users are invisible/inaccessible at the database
-- level — not just hidden in the UI.

-- ---------- Tables ----------
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'em_resolucao', 'concluido')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_sender_id_idx ON public.tasks (sender_id);
CREATE INDEX IF NOT EXISTS tasks_recipient_id_idx ON public.tasks (recipient_id);

CREATE TABLE IF NOT EXISTS public.task_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- The user who should see the notice (the original sender of the task).
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_notifications_user_id_idx
  ON public.task_notifications (user_id, read);

-- ---------- RLS ----------
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_notifications ENABLE ROW LEVEL SECURITY;

-- tasks: only the sender or recipient may see/act on a row.
DROP POLICY IF EXISTS "read own tasks" ON public.tasks;
CREATE POLICY "read own tasks" ON public.tasks
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

-- You may only create a task as yourself (sender), to anyone.
DROP POLICY IF EXISTS "insert own tasks" ON public.tasks;
CREATE POLICY "insert own tasks" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());

-- Both parties can update (recipient advances status; sender can edit).
DROP POLICY IF EXISTS "update own tasks" ON public.tasks;
CREATE POLICY "update own tasks" ON public.tasks
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() OR recipient_id = auth.uid());

-- Only the sender may delete the request they created.
DROP POLICY IF EXISTS "delete own tasks" ON public.tasks;
CREATE POLICY "delete own tasks" ON public.tasks
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

-- task_notifications: a user only sees/updates their own notices. Inserts are
-- performed exclusively by the SECURITY DEFINER trigger below (no client
-- INSERT policy, so direct inserts from the API are blocked).
DROP POLICY IF EXISTS "read own notifications" ON public.task_notifications;
CREATE POLICY "read own notifications" ON public.task_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "update own notifications" ON public.task_notifications;
CREATE POLICY "update own notifications" ON public.task_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------- Trigger: notify sender on completion ----------
CREATE OR REPLACE FUNCTION public.notify_task_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Keep updated_at fresh on every change.
  NEW.updated_at := now();

  -- When the recipient flips the task to "concluido", drop a notice for the
  -- original sender (skip self-assigned tasks to avoid noise).
  IF NEW.status = 'concluido'
     AND OLD.status IS DISTINCT FROM 'concluido'
     AND NEW.sender_id <> NEW.recipient_id THEN
    INSERT INTO public.task_notifications (task_id, user_id, message)
    VALUES (
      NEW.id,
      NEW.sender_id,
      'Sua tarefa "' || NEW.title || '" foi concluída.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_completed ON public.tasks;
CREATE TRIGGER trg_notify_task_completed
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_completed();

-- ---------- Backfill permission ----------
-- Tasks is an internal collaboration tool for everyone: grant view+edit to all
-- existing users so they can immediately send/receive tasks. Admins bypass
-- permission checks regardless.
INSERT INTO public.user_permissions (user_id, module, can_view, can_edit)
SELECT DISTINCT user_id, 'tasks'::public.app_module, true, true
FROM public.user_roles
ON CONFLICT (user_id, module) DO NOTHING;

-- Force PostgREST to reload its schema cache so the REST API immediately sees
-- the new tables.
NOTIFY pgrst, 'reload schema';
