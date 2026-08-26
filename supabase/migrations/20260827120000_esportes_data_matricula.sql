-- Esportes Extracurriculares — data em que o aluno foi matriculado NA MODALIDADE.
--
-- `created_at` já registra quando a linha entrou no School Hub, mas é o instante
-- do cadastro, não a data da matrícula (o vínculo pode ter sido lançado depois
-- do aluno já frequentar). A data passa a ser um campo próprio, editável na
-- tela: os vínculos existentes começam com o dia do cadastro como melhor
-- aproximação, e a escola corrige onde for necessário.

ALTER TABLE public.esportes_matriculas
  ADD COLUMN IF NOT EXISTS data_matricula date NOT NULL DEFAULT current_date;

UPDATE public.esportes_matriculas
   SET data_matricula = (created_at AT TIME ZONE 'America/Sao_Paulo')::date
 WHERE data_matricula = current_date
   AND created_at < now();

NOTIFY pgrst, 'reload schema';
