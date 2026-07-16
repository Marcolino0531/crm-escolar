-- Admissões: arquivamento de leads.
--
-- Adiciona a coluna public.leads.arquivado (boolean). Quando a usuária clica em
-- "Avançar" num cartão da coluna Matrícula, o aluno é enviado ao Onboarding e o
-- lead é marcado como arquivado — saindo da visualização principal do Kanban
-- SEM apagar o registro, preservando o histórico (coluna = 'matricula').

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS arquivado boolean NOT NULL DEFAULT false;

-- Índice parcial para acelerar o carregamento do funil (apenas leads ativos).
CREATE INDEX IF NOT EXISTS leads_arquivado_idx
  ON public.leads (arquivado)
  WHERE arquivado = false;
