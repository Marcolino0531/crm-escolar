-- Teste da policy de INSERT do bucket `whatsapp-media` (envio de mídia pelo
-- Atendimento). Roda inteiro dentro de um bloco que termina em exceção, então
-- nada é gravado: os usuários e permissões criados aqui desaparecem no rollback.
--
-- Uso: rodar o arquivo no banco (SQL Editor do Supabase ou psql). O resultado
-- sai na mensagem final, que deve ser exatamente:
--   RESULTADO: com_permissao=PERMITIDO; sem_permissao=BLOQUEADO;
--              fora_do_prefixo=BLOQUEADO; outro_bucket=BLOQUEADO;

DO $$
DECLARE
  autorizado uuid := gen_random_uuid();
  negado uuid := gen_random_uuid();
  res text := '';
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES
    (autorizado, 'rls-autorizado@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (negado, 'rls-negado@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  -- Só o primeiro recebe Editar em Atendimento.
  INSERT INTO public.user_permissions (user_id, module, can_view, can_edit)
  VALUES (autorizado, 'financeiro_atendimento'::public.app_module, true, true);
  INSERT INTO public.user_permissions (user_id, module, can_view, can_edit)
  VALUES (negado, 'financeiro_atendimento'::public.app_module, true, false);

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', autorizado, 'role', 'authenticated')::text, true);
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('whatsapp-media', 'saida/2026/08/teste.png', autorizado);
    res := res || 'com_permissao=PERMITIDO; ';
  EXCEPTION WHEN insufficient_privilege THEN
    res := res || 'com_permissao=BLOQUEADO; ';
  END;
  RESET ROLE;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', negado, 'role', 'authenticated')::text, true);
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('whatsapp-media', 'saida/2026/08/teste-negado.png', negado);
    res := res || 'sem_permissao=PERMITIDO; ';
  EXCEPTION WHEN insufficient_privilege THEN
    res := res || 'sem_permissao=BLOQUEADO; ';
  END;
  RESET ROLE;

  -- Mídia recebida (fora de "saida/") continua sendo escrita só pelo servidor.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', autorizado, 'role', 'authenticated')::text, true);
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('whatsapp-media', 'entrada/2026/08/teste.png', autorizado);
    res := res || 'fora_do_prefixo=PERMITIDO; ';
  EXCEPTION WHEN insufficient_privilege THEN
    res := res || 'fora_do_prefixo=BLOQUEADO; ';
  END;
  RESET ROLE;

  -- A permissão de Atendimento não vaza para outros buckets.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', autorizado, 'role', 'authenticated')::text, true);
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('hr-documents', 'saida/2026/08/teste.pdf', autorizado);
    res := res || 'outro_bucket=PERMITIDO; ';
  EXCEPTION WHEN insufficient_privilege THEN
    res := res || 'outro_bucket=BLOQUEADO; ';
  END;
  RESET ROLE;

  RAISE EXCEPTION 'RESULTADO: %', res;
END $$;
