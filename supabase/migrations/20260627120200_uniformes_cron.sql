-- Cron noturno (03h) de auditoria/reconciliação do estoque de uniformes.
--
-- Agenda uma chamada diária à Edge Function `nuvemshop-sync` via pg_cron + pg_net.
-- Depende de:
--   1) Edge Function `nuvemshop-sync` já deployada;
--   2) Dois segredos no Supabase Vault: 'project_url' e 'service_role_key'.
--
-- A migration é DEFENSIVA: só agenda o job se as extensões e os segredos do Vault
-- existirem. Assim ela pode ser aplicada com segurança antes do deploy/secrets
-- (vira no-op) e basta re-rodar este bloco depois que tudo estiver configurado.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Vault disponível?
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'Vault indisponível — pulando agendamento do cron de uniformes.';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'Segredos project_url/service_role_key ausentes no Vault — cron de uniformes não agendado.';
    RETURN;
  END IF;

  -- Remove agendamento anterior (idempotência).
  PERFORM cron.unschedule('nuvemshop-nightly-sync')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nuvemshop-nightly-sync');

  PERFORM cron.schedule(
    'nuvemshop-nightly-sync',
    '0 3 * * *',
    format(
      $cron$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L
        ),
        body := jsonb_build_object('source', 'cron')
      );
      $cron$,
      v_url || '/functions/v1/nuvemshop-sync',
      v_key
    )
  );
END $$;
