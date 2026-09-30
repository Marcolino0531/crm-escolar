-- Conferência da submissão do formulário de matrícula contra o Sponte
-- ("Verificar no Sponte" na tela Matrículas / e-Formulário).
--
-- conferencia guarda o resultado detalhado da última verificação (data, turma
-- encontrada, itens de cobrança ok / aviso / faltando / dispensado e avisos).
-- conferido_em/por/por_nome só são preenchidos quando turma e cobranças estão
-- de acordo com o Sponte: a partir daí a conferência fica fixada.
--
-- Com a conferência fixada, o gatilho mantém turma_status, turma_nome,
-- faturamento_status, faturamento_pendencia, turma_pendencia e a baixa da
-- pendência como estavam, e as linhas de matricula_faturamento_lancamentos da
-- submissão não recebem inserções nem alterações. Desfazer a conferência
-- (conferido_em volta a nulo) libera de novo. aluno_nome continua livre.
--
-- Só aditiva: nenhuma linha existente é alterada (todas começam não conferidas).

BEGIN;

ALTER TABLE public.enrollment_submissions
  ADD COLUMN IF NOT EXISTS conferido_em timestamptz,
  ADD COLUMN IF NOT EXISTS conferido_por uuid,
  ADD COLUMN IF NOT EXISTS conferido_por_nome text,
  ADD COLUMN IF NOT EXISTS conferencia jsonb;

CREATE OR REPLACE FUNCTION public.enrollment_submissions_conferencia_fixa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.conferido_em IS NOT NULL AND NEW.conferido_em IS NOT NULL THEN
    NEW.turma_status := OLD.turma_status;
    NEW.turma_nome := OLD.turma_nome;
    NEW.turma_pendencia := OLD.turma_pendencia;
    NEW.faturamento_status := OLD.faturamento_status;
    NEW.faturamento_pendencia := OLD.faturamento_pendencia;
    NEW.pendencia_resolvida_em := OLD.pendencia_resolvida_em;
    NEW.pendencia_resolvida_por := OLD.pendencia_resolvida_por;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enrollment_submissions_conferencia_fixa ON public.enrollment_submissions;
CREATE TRIGGER enrollment_submissions_conferencia_fixa
  BEFORE UPDATE ON public.enrollment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enrollment_submissions_conferencia_fixa();

CREATE OR REPLACE FUNCTION public.matricula_faturamento_conferencia_fixa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.enrollment_submissions s
    WHERE s.submission_id = NEW.submission_id AND s.conferido_em IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matricula_faturamento_conferencia_fixa ON public.matricula_faturamento_lancamentos;
CREATE TRIGGER matricula_faturamento_conferencia_fixa
  BEFORE INSERT OR UPDATE ON public.matricula_faturamento_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.matricula_faturamento_conferencia_fixa();

REVOKE EXECUTE ON FUNCTION public.enrollment_submissions_conferencia_fixa() FROM anon;
REVOKE EXECUTE ON FUNCTION public.matricula_faturamento_conferencia_fixa() FROM anon;

COMMIT;
