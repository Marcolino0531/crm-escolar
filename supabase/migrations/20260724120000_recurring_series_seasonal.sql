-- Despesa Fixa Sazonal: matriz de meses de incidência (1..12) para séries que
-- se repetem anualmente apenas em meses específicos (ex.: taxa TFLF, meses 5..12).
-- NULL ou vazio => série fixa normal (todos os meses). Preenchido => a série só
-- é materializada nos meses de calendário listados, repetindo o ciclo todo ano.
ALTER TABLE public.recurring_series
  ADD COLUMN IF NOT EXISTS incidence_months smallint[];

NOTIFY pgrst, 'reload schema';
