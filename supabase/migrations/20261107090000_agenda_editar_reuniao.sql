-- Agenda: editar reunião (somente quem criou).
--
-- 1) UPDATE de agenda_reunioes passa a exigir, além da permissão de edição do
--    módulo, que o usuário seja o autor (created_by = auth.uid()). Reuniões com
--    created_by nulo deixam de ser editáveis. SELECT, INSERT e DELETE não mudam;
--    agenda_colaboradores não muda.
-- 2) O trigger de avisos passa a tratar a edição completa:
--    - quem ENTROU na Equipe: "Você foi incluído em uma reunião" (regra atual);
--    - quem SAIU: avisos pendentes (concluded_at nulo) da reunião são apagados;
--    - quem CONTINUA e a data/horário mudaram: avisos pendentes antigos são
--      concluídos e nasce "Reunião alterada: <responsável>, DD/MM/AAAA às HH:MM";
--    - o autor nunca é avisado; mudança só de responsável/aluno/unidade não avisa.

-- ─── 1) Policy de UPDATE: só o autor ─────────────────────────────────────────
DROP POLICY IF EXISTS "agenda update agenda_reunioes" ON public.agenda_reunioes;
CREATE POLICY "agenda update agenda_reunioes" ON public.agenda_reunioes
  FOR UPDATE TO authenticated
  USING (
    public.can_edit_module(auth.uid(), 'agenda'::public.app_module)
    AND created_by = auth.uid()
  )
  WITH CHECK (
    public.can_edit_module(auth.uid(), 'agenda'::public.app_module)
    AND created_by = auth.uid()
  );

-- ─── 2) Trigger de avisos ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agenda_notify_participantes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  antigos uuid[] := '{}';
  novos uuid[];
  saiu uuid[] := '{}';
  continua uuid[] := '{}';
  uid uuid;
  quando text;
  horario_mudou boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    antigos := COALESCE(OLD.participante_ids, '{}');
    SELECT COALESCE(array_agg(x), '{}') INTO novos
      FROM unnest(COALESCE(NEW.participante_ids, '{}')) AS x
      WHERE NOT (x = ANY(antigos));
    SELECT COALESCE(array_agg(x), '{}') INTO saiu
      FROM unnest(antigos) AS x
      WHERE NOT (x = ANY(COALESCE(NEW.participante_ids, '{}')));
    SELECT COALESCE(array_agg(x), '{}') INTO continua
      FROM unnest(antigos) AS x
      WHERE x = ANY(COALESCE(NEW.participante_ids, '{}'));
    horario_mudou := NEW.data IS DISTINCT FROM OLD.data
                  OR COALESCE(NEW.horario, '') IS DISTINCT FROM COALESCE(OLD.horario, '');
  ELSE
    novos := COALESCE(NEW.participante_ids, '{}');
  END IF;

  quando := to_char(NEW.data, 'DD/MM/YYYY')
            || CASE WHEN NEW.horario IS NOT NULL AND NEW.horario <> ''
                    THEN ' às ' || NEW.horario ELSE '' END;

  -- Quem saiu: apaga os avisos pendentes dessa reunião.
  IF array_length(saiu, 1) > 0 THEN
    DELETE FROM public.agenda_notifications
      WHERE reuniao_id = NEW.id
        AND concluded_at IS NULL
        AND user_id = ANY(saiu);
  END IF;

  -- Quem continua e teve data/horário alterados: conclui os pendentes e avisa.
  IF horario_mudou AND array_length(continua, 1) > 0 THEN
    UPDATE public.agenda_notifications
      SET concluded_at = now()
      WHERE reuniao_id = NEW.id
        AND concluded_at IS NULL
        AND user_id = ANY(continua);
    FOREACH uid IN ARRAY continua LOOP
      IF NEW.created_by IS NOT NULL AND uid = NEW.created_by THEN
        CONTINUE;
      END IF;
      INSERT INTO public.agenda_notifications (reuniao_id, user_id, message)
      VALUES (
        NEW.id,
        uid,
        'Reunião alterada: '
          || COALESCE(NULLIF(NEW.responsavel_nome, ''), 'Responsável')
          || ', ' || quando
      );
    END LOOP;
  END IF;

  -- Quem entrou: aviso de inclusão (regra atual).
  FOREACH uid IN ARRAY novos LOOP
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

-- O trigger precisa disparar também quando só data/horário mudam.
DROP TRIGGER IF EXISTS agenda_notify_participantes_trg ON public.agenda_reunioes;
CREATE TRIGGER agenda_notify_participantes_trg
  AFTER INSERT OR UPDATE OF participante_ids, data, horario ON public.agenda_reunioes
  FOR EACH ROW EXECUTE FUNCTION public.agenda_notify_participantes();
