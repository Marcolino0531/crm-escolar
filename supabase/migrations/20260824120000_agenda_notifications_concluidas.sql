-- Agenda: conclusão das notificações de reunião no sininho.
--
-- `concluded_at` marca a notificação como resolvida (check manual no sininho ou
-- conclusão automática de reunião que já passou). A linha NÃO é apagada: fica no
-- banco como histórico das reuniões passadas.
--
-- RLS não muda: as policies existentes já permitem que cada usuário atualize
-- somente as próprias notificações (`user_id = auth.uid()`), o que cobre a
-- gravação de `concluded_at`.

ALTER TABLE public.agenda_notifications
  ADD COLUMN IF NOT EXISTS concluded_at timestamptz;

-- O sininho lista as pendentes do usuário: pendente = concluded_at IS NULL.
CREATE INDEX IF NOT EXISTS agenda_notifications_pendentes_idx
  ON public.agenda_notifications (user_id, concluded_at);
