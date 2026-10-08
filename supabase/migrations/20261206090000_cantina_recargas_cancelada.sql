-- Cantina > Solicitações de recarga: cancelamento de uma solicitação pendente.
-- Colunas de quem cancelou e quando, e o status 'cancelada' no CHECK de status.
-- Aditiva: nenhum UPDATE ou DELETE de dados; RLS, policies e privilégios de
-- public.cantina_recargas não mudam.

BEGIN;

ALTER TABLE public.cantina_recargas
  ADD COLUMN IF NOT EXISTS cancelada_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelada_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelada_por_nome text NOT NULL DEFAULT '';

-- O CHECK de status foi criado inline (nome gerado pelo Postgres): localizar
-- pela definição, sem supor o nome, e recriar com os quatro valores.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.cantina_recargas'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
      AND pg_get_constraintdef(c.oid) ILIKE '%lancada_no_boleto%'
  LOOP
    EXECUTE format('ALTER TABLE public.cantina_recargas DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;

ALTER TABLE public.cantina_recargas
  ADD CONSTRAINT cantina_recargas_status_check
    CHECK (status IN ('pendente', 'efetivada', 'lancada_no_boleto', 'cancelada'));

COMMIT;
