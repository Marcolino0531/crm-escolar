-- Backfill Financeiro sub-tab permissions from the umbrella 'financeiro' row so
-- existing users keep the exact same access they had before the module was
-- sliced. Admins pass via user_roles and have no user_permissions rows, so they
-- are unaffected.
--
-- Mapping (per existing 'financeiro' row):
--   dashboard / conciliacao / fluxo / inadimplencia  -> same view + edit
--   upload (Importar Extrato) was edit-gated          -> view = edit, edit = edit

INSERT INTO public.user_permissions (user_id, module, can_view, can_edit)
SELECT up.user_id, sub.module, sub.can_view, sub.can_edit
FROM public.user_permissions up
CROSS JOIN LATERAL (
  VALUES
    ('financeiro_dashboard'::public.app_module,      up.can_view, up.can_edit),
    ('financeiro_conciliacao'::public.app_module,    up.can_view, up.can_edit),
    ('financeiro_fluxo'::public.app_module,          up.can_view, up.can_edit),
    ('financeiro_inadimplencia'::public.app_module,  up.can_view, up.can_edit),
    ('financeiro_upload'::public.app_module,         up.can_edit, up.can_edit)
) AS sub(module, can_view, can_edit)
WHERE up.module = 'financeiro'
ON CONFLICT (user_id, module) DO NOTHING;

-- Force PostgREST to reload its schema cache so the REST API immediately sees
-- any newly created tables/columns (e.g. user_permissions, user_schools).
NOTIFY pgrst, 'reload schema';
