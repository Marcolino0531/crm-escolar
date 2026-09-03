-- Rematrícula (CEC/CEC Baby): matrícula parcelável escolhida no portal público e
-- envio final do formulário.
--
-- A escolha da matrícula segue o MESMO fluxo do material pedagógico: o portal só
-- grava 'pendente_lancamento'; a secretaria efetiva e só então o título é criado
-- no Sponte (categoria Matrícula), com a 1ª parcela na data escolhida pelo
-- responsável e as demais no vencimento real das mensalidades do aluno.

-- A Rematrícula não pergunta mais a data de início (o aluno já está na escola);
-- o formulário de matrícula nova continua gravando a data.
ALTER TABLE public.student_routine ALTER COLUMN data_inicio DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.rematricula_matricula_escolhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  aluno_nome text NOT NULL DEFAULT '',
  serie text NOT NULL DEFAULT '',
  segmento text NOT NULL DEFAULT '',
  valor numeric(12, 2) NOT NULL CHECK (valor > 0),
  parcelas integer NOT NULL CHECK (parcelas BETWEEN 1 AND 5),
  valor_parcela numeric(12, 2) NOT NULL CHECK (valor_parcela > 0),
  valor_primeira_parcela numeric(12, 2) NOT NULL CHECK (valor_primeira_parcela > 0),
  -- Data escolhida pelo responsável (entre o preenchimento e o fim daquele mês).
  primeiro_vencimento date NOT NULL,
  -- Data (servidor, fuso de Brasília) em que o formulário foi preenchido: é ela
  -- que define o mês de referência e o máximo de parcelas.
  data_preenchimento date NOT NULL,
  mes_referencia text NOT NULL DEFAULT '',
  ano_letivo integer,
  status text NOT NULL DEFAULT 'pendente_lancamento'
    CHECK (status IN ('pendente_lancamento', 'efetivada', 'lancada')),
  efetivada_at timestamptz,
  efetivada_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  efetivada_por_nome text NOT NULL DEFAULT '',
  lancada_at timestamptz,
  sponte_conta_receber_id text NOT NULL DEFAULT '',
  sponte_erro text NOT NULL DEFAULT '',
  parcelas_lancadas jsonb,
  historico jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rematricula_matricula_escolhas_aluno_idx
  ON public.rematricula_matricula_escolhas (unidade, aluno_id);

-- Envio final ("Finalizar Matrícula"): uma linha por aluno/unidade, atualizada
-- a cada reenvio enquanto a secretaria não efetivou.
CREATE TABLE IF NOT EXISTS public.rematricula_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL,
  aluno_id text NOT NULL,
  ano_letivo integer,
  enviada_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rematricula_envios_aluno_idx
  ON public.rematricula_envios (unidade, aluno_id);

ALTER TABLE public.rematricula_matricula_escolhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rematricula_envios ENABLE ROW LEVEL SECURITY;

-- Escrita só pelo servidor (service role); leitura interna pelo módulo Rematrícula.
DROP POLICY IF EXISTS rematricula_matricula_escolhas_select ON public.rematricula_matricula_escolhas;
CREATE POLICY rematricula_matricula_escolhas_select ON public.rematricula_matricula_escolhas
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));

DROP POLICY IF EXISTS rematricula_envios_select ON public.rematricula_envios;
CREATE POLICY rematricula_envios_select ON public.rematricula_envios
  FOR SELECT TO authenticated
  USING (public.can_view_module(auth.uid(), 'rematricula'::public.app_module));
