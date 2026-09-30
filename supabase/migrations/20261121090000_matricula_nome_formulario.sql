-- Nome do aluno na tela Matrículas (e-Formulário) acompanha o cadastro do
-- Sponte. aluno_nome passa a ser atualizado pelo nome lido no Sponte
-- (GetAlunos, só leitura); o nome digitado pela família fica guardado em
-- aluno_nome_formulario para a busca e para a ficha. O payload não é alterado.
--
-- Só aditiva: a coluna é preenchida com o aluno_nome atual de todas as linhas
-- existentes (antes de qualquer atualização vinda do Sponte) e, nas novas
-- submissões, o gatilho copia o aluno_nome do momento do recebimento.

BEGIN;

ALTER TABLE public.enrollment_submissions
  ADD COLUMN IF NOT EXISTS aluno_nome_formulario text;

UPDATE public.enrollment_submissions
  SET aluno_nome_formulario = aluno_nome
  WHERE aluno_nome_formulario IS NULL;

CREATE OR REPLACE FUNCTION public.enrollment_submissions_nome_formulario()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.aluno_nome_formulario IS NULL THEN
    NEW.aluno_nome_formulario := NEW.aluno_nome;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enrollment_submissions_nome_formulario ON public.enrollment_submissions;
CREATE TRIGGER enrollment_submissions_nome_formulario
  BEFORE INSERT ON public.enrollment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enrollment_submissions_nome_formulario();

COMMIT;
