-- Elegibilidade de Vale-Transporte por funcionário. Quem não recebe VT não
-- aparece no Fechamento de Vale-Transporte. Default true mantém os funcionários
-- já cadastrados (que já tinham valor_diario_vt) elegíveis.
alter table public.funcionarios
  add column if not exists recebe_vt boolean NOT NULL DEFAULT true;
