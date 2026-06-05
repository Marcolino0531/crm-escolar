-- New top-level module: "Tasks" (internal task manager, Monday-style).
-- The enum value must be added in its own transaction before it can be
-- referenced by the companion migration that backfills permissions.
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'tasks';
