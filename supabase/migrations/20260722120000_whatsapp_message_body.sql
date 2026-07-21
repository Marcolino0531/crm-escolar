-- Cobrança Automática — registro fiel do conteúdo enviado (prova legal).
--
-- Cada disparo de WhatsApp passa a gravar o TEXTO EXATO da mensagem (template já
-- preenchido com as 5 variáveis: Responsável, Aluno, Valor, Vencimento e Linha
-- Digitável). O painel de auditoria exibe esse conteúdo ao clicar no registro,
-- servindo como comprovante do que foi comunicado ao responsável.

ALTER TABLE public.whatsapp_billing_logs
  ADD COLUMN IF NOT EXISTS message_body text;

NOTIFY pgrst, 'reload schema';
