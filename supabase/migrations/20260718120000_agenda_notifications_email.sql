-- Agenda: notificações internas para a Equipe de uma reunião + suporte ao
-- lembrete por email matinal.
--
-- 1) public.agenda_reunioes.participante_ids uuid[]: os usuários do sistema
--    (auth.users) selecionados no campo "Equipe". O array de nomes existente
--    (colaboradores) continua sendo gravado como snapshot para exibição.
-- 2) public.agenda_notifications: avisos in-app (alimentam o sininho). Um
--    registro por usuário adicionado à Equipe de uma reunião.
-- 3) Trigger SECURITY DEFINER que, ao criar/editar uma reunião, gera uma
--    notificação para cada participante RECÉM-adicionado (menos o próprio autor).
--
-- RLS (fail-closed): cada usuário só lê/atualiza as próprias notificações. Os
-- INSERTs são feitos exclusivamente pelo trigger (sem policy de INSERT para o
-- cliente), espelhando o padrão de public.task_notifications.

-- ─── 1) Participantes (usuários do sistema) na reunião ───────────────────────
ALTER TABLE public.agenda_reunioes
  ADD COLUMN IF NOT EXISTS participante_ids uuid[] NOT NULL DEFAULT '{}';

-- ─── 2) Notificações da Agenda ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agenda_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reuniao_id uuid REFERENCES public.agenda_reunioes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agenda_notifications_user_id_idx
  ON public.agenda_notifications (user_id, read);

ALTER TABLE public.agenda_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own agenda notifications" ON public.agenda_notifications;
CREATE POLICY "read own agenda notifications" ON public.agenda_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "update own agenda notifications" ON public.agenda_notifications;
CREATE POLICY "update own agenda notifications" ON public.agenda_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── 3) Trigger: notifica os participantes recém-adicionados ─────────────────
CREATE OR REPLACE FUNCTION public.agenda_notify_participantes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  novos uuid[];
  uid uuid;
  quando text;
BEGIN
  -- Apenas os IDs que passaram a fazer parte da Equipe nesta operação.
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(x), '{}')
      INTO novos
      FROM unnest(NEW.participante_ids) AS x
      WHERE NOT (x = ANY(COALESCE(OLD.participante_ids, '{}')));
  ELSE
    novos := COALESCE(NEW.participante_ids, '{}');
  END IF;

  quando := to_char(NEW.data, 'DD/MM/YYYY')
            || CASE WHEN NEW.horario IS NOT NULL AND NEW.horario <> ''
                    THEN ' às ' || NEW.horario ELSE '' END;

  FOREACH uid IN ARRAY novos LOOP
    -- Não notifica o próprio autor da reunião.
    IF NEW.created_by IS NOT NULL AND uid = NEW.created_by THEN
      CONTINUE;
    END IF;
    INSERT INTO public.agenda_notifications (reuniao_id, user_id, message)
    VALUES (
      NEW.id,
      uid,
      'Você foi incluído em uma reunião: '
        || COALESCE(NULLIF(NEW.responsavel_nome, ''), 'Responsável')
        || ' — ' || quando
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agenda_notify_participantes_trg ON public.agenda_reunioes;
CREATE TRIGGER agenda_notify_participantes_trg
  AFTER INSERT OR UPDATE OF participante_ids ON public.agenda_reunioes
  FOR EACH ROW EXECUTE FUNCTION public.agenda_notify_participantes();
