-- Tasks: record completion date and refine the completion notice.
--
--   • Adds tasks.completed_at — the moment the recipient moved the card to
--     "concluido". Cleared automatically if the task is reopened.
--   • Updates the completion trigger to stamp/clear completed_at and to emit a
--     richer notice naming the recipient who delivered the work.
--
-- The 7-day "archive" of the Concluídos column is a pure display filter applied
-- on the client; archived tasks remain stored here untouched.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Backfill: tasks already concluded get their last-updated time as a best guess.
UPDATE public.tasks
  SET completed_at = updated_at
  WHERE status = 'concluido' AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.notify_task_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_name text;
BEGIN
  -- Keep updated_at fresh on every change.
  NEW.updated_at := now();

  -- Stamp the completion moment when entering "concluido"; clear it whenever the
  -- task leaves that status (e.g. the recipient reopens it).
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'concluido' THEN
    NEW.completed_at := NULL;
  END IF;

  -- When the recipient flips the task to "concluido", drop a notice for the
  -- original sender (skip self-assigned tasks to avoid noise).
  IF NEW.status = 'concluido'
     AND OLD.status IS DISTINCT FROM 'concluido'
     AND NEW.sender_id <> NEW.recipient_id THEN
    SELECT COALESCE(
             NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
             NULLIF(u.raw_user_meta_data ->> 'name', ''),
             split_part(u.email, '@', 1),
             'destinatário'
           )
      INTO recipient_name
      FROM auth.users u
      WHERE u.id = NEW.recipient_id;

    INSERT INTO public.task_notifications (task_id, user_id, message)
    VALUES (
      NEW.id,
      NEW.sender_id,
      'A tarefa "' || NEW.title || '" foi finalizada por ' ||
        COALESCE(recipient_name, 'destinatário') || '.'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger definition is unchanged; recreated for completeness.
DROP TRIGGER IF EXISTS trg_notify_task_completed ON public.tasks;
CREATE TRIGGER trg_notify_task_completed
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_completed();

NOTIFY pgrst, 'reload schema';
