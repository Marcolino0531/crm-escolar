-- New Financeiro sub-tab: "Fundos" (gestão de provisionamento).
-- The enum value must be added in its own transaction before it can be
-- referenced (see the companion migration that backfills permissions).
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'financeiro_fundos';
