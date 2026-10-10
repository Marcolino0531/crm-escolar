-- Segurança por colégio no banco: as policies das tabelas com dimensão de
-- colégio passam a conferir, além da página, se a pessoa tem aquele colégio
-- liberado (public.user_schools; admin vê tudo).
--
-- Migration ADITIVA: não apaga nem altera nenhum dado, não cria policy nova e não
-- muda privilégios. Cada policy existente mantém a condição atual e ganha
-- "AND <escopo>" no USING e no WITH CHECK. Idempotente: expressão que já tem a
-- checagem de colégio é pulada. Não mexe em policy só de admin, de dono
-- (user_id/auth_user_id = auth.uid()) nem de professor.
--
--   can_access_unidade(_user_id, _unidade)          colégio pelo NOME (coluna unidade)
--   can_access_store_uniformes(_user_id, _store_key) colégio pela loja Nuvemshop
--                                                    (mesmo mapa de src/lib/nuvemshop.stores.ts)
--   can_access_funcionario(_user_id, _funcionario_id) colégio do funcionário, sem depender
--                                                    das páginas da policy de funcionarios
--
-- Escopos:
--   A  school_id                 can_access_school(auth.uid(), school_id)
--   B  unidade                   can_access_unidade(auth.uid(), unidade)
--   C  unit_id (pode ser nula)   unit_id IS NULL OR can_access_school(auth.uid(), unit_id)
--   D  filhas sem colégio        EXISTS na mãe com a checagem da mãe; vínculo nulo: só admin
--   U  uniformes (store_key)     can_access_store_uniformes(auth.uid(), store_key)
--
-- Filhas de funcionarios (funcionarios_salarios, hr_employee_documents,
-- rh_experiencia_notificacoes_lidas) usam can_access_funcionario. hr_timesheet_days
-- e hr_timesheet_entries seguem a folha de ponto (timesheet_id -> hr_timesheets).
--
-- EXCEÇÃO: uniform_sync_log fica só com a permissão de página, como hoje. O log é
-- global (cada linha é uma sincronização de todas as lojas) e não tem colégio.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_unidade(_user_id uuid, _unidade text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR (
      NULLIF(btrim(_unidade), '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.schools s
        WHERE s.name = _unidade AND public.can_access_school(_user_id, s.id)
      )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.can_access_unidade(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_unidade(uuid, text) TO authenticated, service_role;

-- Belvedere e Vale do Sereno partilham a loja "belvedere"; CEC e CEC Baby, a "cec".
CREATE OR REPLACE FUNCTION public.can_access_store_uniformes(_user_id uuid, _store_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.name = ANY (
          CASE _store_key
            WHEN 'belvedere' THEN ARRAY['Núcleo Belvedere', 'Núcleo Vale do Sereno']
            WHEN 'cec' THEN ARRAY['CEC', 'CEC Baby']
            ELSE ARRAY[]::text[]
          END
        )
        AND public.can_access_school(_user_id, s.id)
    );
$$;
REVOKE EXECUTE ON FUNCTION public.can_access_store_uniformes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_store_uniformes(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_funcionario(_user_id uuid, _funcionario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.id = _funcionario_id AND public.can_access_school(_user_id, f.school_id)
    );
$$;
REVOKE EXECUTE ON FUNCTION public.can_access_funcionario(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_funcionario(uuid, uuid) TO authenticated, service_role;

DO $$
DECLARE
  -- grupo | tabela | escopo (%1$I = nome da tabela, para qualificar a coluna da filha)
  alvos text[][] := ARRAY[
    ['A', 'boleto_reconciliations', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'colonia_valores', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'diario_auditoria_execucoes', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'diario_auditoria_inconsistencias', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'diario_classes', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'diario_students', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'diario_faturamentos', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'holiday_camp_invoices', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'holiday_camp_records', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'holiday_camp_week_status', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'hr_payslip_sends', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'hr_timesheets', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'hr_transport_batches', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'initial_balances', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'provision_funds', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'reconciliations', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'recurring_series', 'public.can_access_school(auth.uid(), school_id)'],
    ['A', 'terceirizados', 'public.can_access_school(auth.uid(), school_id)'],
    ['B', 'ai_suggestions', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'ai_training_examples', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'cantina_recargas', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'contrato_testemunhas', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'contratos_matricula', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'diario_precos_extras', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'documentos_colegios', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'documentos_recibos', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'enrollment_submissions', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'esportes_modalidades', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'material_pedagogico_itens', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'material_pedagogico_series', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'matricula_documentos', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'matricula_documentos_historico', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'matricula_faturamento_lancamentos', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'matricula_saude', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'rematricula_acessos', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'rematricula_cadastro_auditoria', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'rematricula_envios', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'rematricula_escolhas', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'rematricula_extras_divergencias', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'rematricula_extras_escolhas', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'rematricula_matricula_escolhas', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'rematricula_matricula_valores', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'rematricula_responsavel_financeiro', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'student_routine', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'unidade_valores_opcionais', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'whatsapp_billing_exceptions', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'whatsapp_billing_pauses', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'whatsapp_conversations', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'whatsapp_falhas_arquivadas', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'whatsapp_lembrete_pausas', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['B', 'zapsign_documentos', 'public.can_access_unidade(auth.uid(), unidade)'],
    ['C', 'agenda_reunioes', '(unit_id IS NULL OR public.can_access_school(auth.uid(), unit_id))'],
    ['C', 'credit_card_receivables', '(unit_id IS NULL OR public.can_access_school(auth.uid(), unit_id))'],
    ['D', 'boleto_reconciliation_items', 'EXISTS (SELECT 1 FROM public.boleto_reconciliations m WHERE m.id = %1$I.reconciliation_id AND public.can_access_school(auth.uid(), m.school_id))'],
    ['D', 'diario_events', 'EXISTS (SELECT 1 FROM public.diario_students m WHERE m.id = %1$I.student_id AND public.can_access_school(auth.uid(), m.school_id))'],
    ['D', 'diario_meal_plans', 'EXISTS (SELECT 1 FROM public.diario_students m WHERE m.id = %1$I.student_id AND public.can_access_school(auth.uid(), m.school_id))'],
    ['D', 'diario_schedules', 'EXISTS (SELECT 1 FROM public.diario_students m WHERE m.id = %1$I.student_id AND public.can_access_school(auth.uid(), m.school_id))'],
    ['D', 'diario_matriculas_ano', 'EXISTS (SELECT 1 FROM public.diario_students m WHERE m.id = %1$I.student_id AND public.can_access_school(auth.uid(), m.school_id))'],
    ['D', 'esportes_frequencias', 'EXISTS (SELECT 1 FROM public.esportes_modalidades m WHERE m.id = %1$I.modalidade_id AND public.can_access_unidade(auth.uid(), m.unidade))'],
    ['D', 'esportes_matriculas', 'EXISTS (SELECT 1 FROM public.esportes_modalidades m WHERE m.id = %1$I.modalidade_id AND public.can_access_unidade(auth.uid(), m.unidade))'],
    ['D', 'esportes_parceiros', 'EXISTS (SELECT 1 FROM public.esportes_modalidades m WHERE m.id = %1$I.modalidade_id AND public.can_access_unidade(auth.uid(), m.unidade))'],
    ['D', 'esportes_repasses', 'EXISTS (SELECT 1 FROM public.esportes_modalidades m WHERE m.id = %1$I.modalidade_id AND public.can_access_unidade(auth.uid(), m.unidade))'],
    ['D', 'esportes_turmas', 'EXISTS (SELECT 1 FROM public.esportes_modalidades m WHERE m.id = %1$I.modalidade_id AND public.can_access_unidade(auth.uid(), m.unidade))'],
    ['D', 'funcionarios_salarios', 'public.can_access_funcionario(auth.uid(), funcionario_id)'],
    ['D', 'hr_employee_documents', 'public.can_access_funcionario(auth.uid(), employee_id)'],
    ['D', 'rh_experiencia_notificacoes_lidas', 'public.can_access_funcionario(auth.uid(), funcionario_id)'],
    ['D', 'hr_timesheet_days', 'EXISTS (SELECT 1 FROM public.hr_timesheets m WHERE m.id = %1$I.timesheet_id AND public.can_access_school(auth.uid(), m.school_id))'],
    ['D', 'hr_timesheet_entries', 'EXISTS (SELECT 1 FROM public.hr_timesheets m WHERE m.id = %1$I.timesheet_id AND public.can_access_school(auth.uid(), m.school_id))'],
    ['D', 'hr_transport_batch_items', 'EXISTS (SELECT 1 FROM public.hr_transport_batches m WHERE m.id = %1$I.batch_id AND public.can_access_school(auth.uid(), m.school_id))'],
    ['D', 'whatsapp_messages', 'EXISTS (SELECT 1 FROM public.whatsapp_conversations m WHERE m.id = %1$I.conversation_id AND public.can_access_unidade(auth.uid(), m.unidade))'],
    ['D', 'zapsign_eventos', 'EXISTS (SELECT 1 FROM public.zapsign_documentos m WHERE m.id = %1$I.documento_id AND public.can_access_unidade(auth.uid(), m.unidade))'],
    ['U', 'uniform_products', 'public.can_access_store_uniformes(auth.uid(), store_key)'],
    ['U', 'uniform_variants', 'public.can_access_store_uniformes(auth.uid(), store_key)'],
    ['U', 'uniform_order_marks', 'public.can_access_store_uniformes(auth.uid(), store_key)']
  ];
  -- Checagem de colégio já presente (has_school_access tem o mesmo corpo de can_access_school).
  marca constant text := 'can_access_school|can_access_unidade|can_access_store_uniformes|can_access_funcionario|has_school_access';
  i int;
  escopo text;
  p record;
  limpo text;
  novo_using text;
  novo_check text;
  alteradas jsonb := '{}'::jsonb;
BEGIN
  FOR i IN 1 .. array_length(alvos, 1) LOOP
    escopo := format(alvos[i][3], alvos[i][2]);
    FOR p IN
      SELECT policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = alvos[i][2]
      ORDER BY policyname
    LOOP
      limpo := regexp_replace(coalesce(p.qual, p.with_check), '[\s()]', '', 'g');
      CONTINUE WHEN limpo = 'has_roleauth.uid,''admin''::app_role'
        OR limpo ~ '^(user_id|auth_user_id)=auth\.uid$'
        OR coalesce(p.qual, '') || coalesce(p.with_check, '') ~ 'professor_';

      novo_using := CASE WHEN p.qual IS NOT NULL AND p.qual !~ marca
        THEN format('(%s) AND %s', p.qual, escopo) END;
      novo_check := CASE WHEN p.with_check IS NOT NULL AND p.with_check !~ marca
        THEN format('(%s) AND %s', p.with_check, escopo) END;
      CONTINUE WHEN novo_using IS NULL AND novo_check IS NULL;

      IF novo_using IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', p.policyname, alvos[i][2], novo_using);
      END IF;
      IF novo_check IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', p.policyname, alvos[i][2], novo_check);
      END IF;
      alteradas := jsonb_set(alteradas, ARRAY[alvos[i][1]],
        to_jsonb(coalesce((alteradas ->> alvos[i][1])::int, 0) + 1));
    END LOOP;
  END LOOP;
  RAISE NOTICE 'policies alteradas por grupo: %', alteradas;
END $$;

COMMIT;
