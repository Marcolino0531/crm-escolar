-- Novo status de integração para submissões rejeitadas na validação do webhook
-- (payload inválido, ex.: "endereco.cep: CEP é obrigatório"). Antes essas
-- tentativas não eram persistidas — o único rastro ficava no log do Apps
-- Script. Agora o webhook grava a tentativa com status 'erro_validacao' para
-- dar visibilidade no painel /matriculas, sem enviar nada ao Sponte.

ALTER TABLE public.enrollment_submissions
  DROP CONSTRAINT IF EXISTS enrollment_submissions_status_check;

ALTER TABLE public.enrollment_submissions
  ADD CONSTRAINT enrollment_submissions_status_check CHECK (
    status IN ('sucesso', 'duplicado', 'erro_aluno', 'erro_responsavel', 'erro_validacao')
  );

NOTIFY pgrst, 'reload schema';
