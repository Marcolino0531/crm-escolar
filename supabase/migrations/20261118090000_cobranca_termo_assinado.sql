-- Termo de Confissão de Dívida assinado como anexo da cobrança.
-- Só aditiva: amplia o CHECK de categoria de cobranca_anexos mantendo todas as
-- categorias atuais (definidas em 20261105090000_cobranca_casos.sql).

ALTER TABLE public.cobranca_anexos
  DROP CONSTRAINT IF EXISTS cobranca_anexos_categoria_check;

ALTER TABLE public.cobranca_anexos
  ADD CONSTRAINT cobranca_anexos_categoria_check CHECK (categoria IN (
    'notificacao_enviada','print_notificacao','contrato','ficha_matricula',
    'demonstrativo','prestacao_servico','transferencia','docs_responsavel','outro',
    'termo_confissao_assinado'
  ));
