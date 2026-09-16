-- RH: nome dos funcionários em Title Case.
--
-- funcionarios.nome_completo chegava em CAIXA ALTA (importação/cadastro manual)
-- e essa grafia se propagava para as tabelas que copiam o nome no momento do
-- lançamento. Mesmo padrão do trigger de leads (20260630120000): a função
-- public.title_case() preserva preposições em minúsculo ("de", "da", ...).
--
-- 1) Trigger BEFORE INSERT OR UPDATE em public.funcionarios.
-- 2) Backfill único em funcionarios e nas cópias do nome:
--    hr_payslip_sends.employee_nome (contracheques),
--    hr_timesheet_entries.employee_nome (ponto),
--    hr_transport_batch_items.employee_name (folhas de VT).

CREATE OR REPLACE FUNCTION public.funcionarios_format_names()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.nome_completo := public.title_case(NEW.nome_completo);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS funcionarios_format_names_trg ON public.funcionarios;
CREATE TRIGGER funcionarios_format_names_trg
  BEFORE INSERT OR UPDATE ON public.funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.funcionarios_format_names();

UPDATE public.funcionarios
   SET nome_completo = public.title_case(nome_completo)
 WHERE nome_completo IS DISTINCT FROM public.title_case(nome_completo);

UPDATE public.hr_payslip_sends
   SET employee_nome = public.title_case(employee_nome)
 WHERE employee_nome IS DISTINCT FROM public.title_case(employee_nome);

UPDATE public.hr_timesheet_entries
   SET employee_nome = public.title_case(employee_nome)
 WHERE employee_nome IS DISTINCT FROM public.title_case(employee_nome);

UPDATE public.hr_transport_batch_items
   SET employee_name = public.title_case(employee_name)
 WHERE employee_name IS DISTINCT FROM public.title_case(employee_name);
