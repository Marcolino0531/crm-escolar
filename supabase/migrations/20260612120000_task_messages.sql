-- In-ticket chat ("Chat/Observações") for the Tasks module.
--
-- Append-only messages attached to a task. PRIVACY: only the sender or the
-- recipient of the parent task can read the history or post new messages —
-- enforced at the database level via RLS (a participant check against `tasks`).

CREATE TABLE IF NOT EXISTS public.task_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_messages_task_id_idx
  ON public.task_messages (task_id, created_at);

ALTER TABLE public.task_messages ENABLE ROW LEVEL SECURITY;

-- Only participants (sender/recipient) of the parent task may read messages.
DROP POLICY IF EXISTS "read task messages" ON public.task_messages;
CREATE POLICY "read task messages" ON public.task_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
        AND (t.sender_id = auth.uid() OR t.recipient_id = auth.uid())
    )
  );

-- You may only post as yourself, and only on tasks you participate in.
DROP POLICY IF EXISTS "insert task messages" ON public.task_messages;
CREATE POLICY "insert task messages" ON public.task_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
        AND (t.sender_id = auth.uid() OR t.recipient_id = auth.uid())
    )
  );

-- Force PostgREST to reload its schema cache so the REST API immediately sees
-- the new table.
NOTIFY pgrst, 'reload schema';
