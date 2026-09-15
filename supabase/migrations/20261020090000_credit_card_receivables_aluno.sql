-- Vínculo informativo do recebível de cartão com o aluno do Sponte (mesmo padrão
-- de esportes_matriculas: AlunoID textual + nome congelado no momento do cadastro;
-- a unidade já está em unit_id). Não gera nem sincroniza nada no Extrato.
ALTER TABLE public.credit_card_receivables
  ADD COLUMN IF NOT EXISTS aluno_id text,
  ADD COLUMN IF NOT EXISTS aluno_nome text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS credit_card_receivables_aluno_idx
  ON public.credit_card_receivables (unit_id, aluno_id);
