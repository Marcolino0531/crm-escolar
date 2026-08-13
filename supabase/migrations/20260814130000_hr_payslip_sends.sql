-- Envio automático de contracheques (RH).
--
-- O cadastro de funcionário não tinha email — só nome/CPF/cargo —, então o
-- envio individual não teria para onde ir. A coluna abaixo é o endereço usado
-- no disparo; funcionário sem email fica sinalizado na conferência e é
-- resolvido à mão.
ALTER TABLE public.funcionarios
  ADD COLUMN IF NOT EXISTS email text;

-- Histórico dos disparos, no mesmo espírito do Histórico de Envios da Cobrança
-- Automática: uma linha por funcionário por competência, com status e erro.
-- NÃO guarda o PDF: contracheque é dado sensível e o arquivo original fica com
-- o RH; aqui só o rastro de que foi enviado, para quem, quando e por quem.
CREATE TABLE IF NOT EXISTS public.hr_payslip_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools (id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.funcionarios (id) ON DELETE SET NULL,
  employee_nome text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  -- Competência do contracheque no formato YYYY-MM (mês de referência).
  competencia text NOT NULL,
  -- Página do PDF original de onde saiu o anexo (rastreia recorte errado).
  pagina integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('enviado', 'falha')),
  erro text,
  provider_message_id text,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  enviado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  enviado_por_nome text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS hr_payslip_sends_competencia_idx
  ON public.hr_payslip_sends (competencia, enviado_em DESC);
CREATE INDEX IF NOT EXISTS hr_payslip_sends_employee_idx
  ON public.hr_payslip_sends (employee_id);

ALTER TABLE public.hr_payslip_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr payslip sends select" ON public.hr_payslip_sends;

CREATE POLICY "hr payslip sends select" ON public.hr_payslip_sends
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rh'::public.app_module));

-- Sem policy de INSERT/UPDATE/DELETE: o registro é escrito pela server function
-- (service role) junto com o disparo, e histórico de envio não se edita.
