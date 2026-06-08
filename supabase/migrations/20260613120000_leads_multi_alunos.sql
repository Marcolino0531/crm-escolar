-- Suporte a múltiplos alunos (irmãos) por lead (negociação familiar).
-- A coluna `alunos` guarda a lista completa; as colunas escalares
-- (nome_aluno/idade/data_nascimento/turma) continuam refletindo o 1º aluno
-- para compatibilidade com Onboarding, Matrícula e cards já existentes.

alter table public.leads
  add column if not exists alunos jsonb not null default '[]'::jsonb;

-- Backfill: leads existentes viram um array de um único aluno a partir
-- dos campos escalares atuais.
update public.leads
set alunos = jsonb_build_array(
  jsonb_build_object(
    'nome', coalesce(nome_aluno, ''),
    'dataNascimento', coalesce(data_nascimento, ''),
    'idade', coalesce(idade, ''),
    'turma', coalesce(turma, '')
  )
)
where alunos = '[]'::jsonb or alunos is null;

notify pgrst, 'reload schema';
