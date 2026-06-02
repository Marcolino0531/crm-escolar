-- Slice the Financeiro module into independently authorizable sub-tabs.
-- New enum values must be added in their own transaction before they can be
-- referenced (see the companion backfill migration). Hence this file only
-- extends the enum.

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_dashboard';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_upload';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_conciliacao';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_fluxo';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_inadimplencia';
