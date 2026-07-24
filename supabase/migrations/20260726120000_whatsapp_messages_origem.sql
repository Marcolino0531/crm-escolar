-- Distingue a origem das mensagens do chat de Atendimento: respostas do atendente
-- (chat) vs. disparos automáticos de template da Cobrança Automática (cobranca).
-- Existentes ficam como 'chat' (padrão); só os templates espelhados usam 'cobranca'.
alter table public.whatsapp_messages
  add column if not exists origem text not null default 'chat';

comment on column public.whatsapp_messages.origem is
  'chat = mensagem do atendimento (recebida/resposta); cobranca = disparo automático de template.';
