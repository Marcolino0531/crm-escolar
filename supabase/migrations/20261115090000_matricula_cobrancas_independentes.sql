-- Cobranças independentes do formulário de matrícula (alunos novos).
--
-- A Matrícula deixa de vir do plano do Sponte: o valor é o cadastro "Valor da
-- Matrícula" do School Hub e o responsável escolhe parcelas e 1º vencimento no
-- formulário. A escolha fica gravada na submissão (como já acontece com o
-- material) para a ficha e para o faturamento não dependerem do cadastro
-- continuar igual. O status geral ganha 'sem_lancamento' (nenhum tipo pôde ser
-- lançado); 'sem_plano' e 'nao_aplicavel' continuam válidos para o histórico.
-- `pendencia_resolvida_em` é a baixa manual do aviso do sino (turma/cobrança
-- tratadas pela secretaria direto no Sponte): a pendência deixa de aparecer.

ALTER TABLE public.enrollment_submissions
  ADD COLUMN IF NOT EXISTS matricula_valor numeric(12, 2),
  ADD COLUMN IF NOT EXISTS matricula_parcelas integer,
  ADD COLUMN IF NOT EXISTS matricula_primeiro_vencimento date,
  ADD COLUMN IF NOT EXISTS pendencia_resolvida_em timestamptz,
  ADD COLUMN IF NOT EXISTS pendencia_resolvida_por text;

ALTER TABLE public.enrollment_submissions
  DROP CONSTRAINT IF EXISTS enrollment_submissions_matricula_parcelas_check;

ALTER TABLE public.enrollment_submissions
  ADD CONSTRAINT enrollment_submissions_matricula_parcelas_check
  CHECK (matricula_parcelas IS NULL OR matricula_parcelas BETWEEN 1 AND 5);

ALTER TABLE public.enrollment_submissions
  DROP CONSTRAINT IF EXISTS enrollment_submissions_faturamento_status_check;

ALTER TABLE public.enrollment_submissions
  ADD CONSTRAINT enrollment_submissions_faturamento_status_check
  CHECK (
    faturamento_status IS NULL
    OR faturamento_status IN ('lancado', 'parcial', 'sem_lancamento', 'sem_plano', 'erro', 'nao_aplicavel')
  );
