-- Testemunhas de Documentos por unidade.
--
-- contrato_testemunhas nasceu como cadastro GLOBAL (2 pessoas para todo o
-- sistema). Passa a ser por unidade (2 pessoas por unidade), como o resto do
-- sistema. Backfill: as linhas globais existentes ficam com o CEC e cada uma
-- das outras unidades recebe uma cópia (mesmo nome, CPF, e-mail, celular,
-- ordem e flag ativa), preservando o comportamento atual.

alter table public.contrato_testemunhas
  add column if not exists unidade text not null default '';

-- O índice global por ordem impediria as cópias por unidade.
drop index if exists public.contrato_testemunhas_ordem_ativa_idx;

-- Linhas globais (sem unidade) viram as do CEC.
update public.contrato_testemunhas set unidade = 'CEC' where unidade = '';

-- Cópia para as demais unidades, a partir das linhas ativas do CEC, só onde a
-- unidade ainda não tem aquela ordem ativa (idempotente).
insert into public.contrato_testemunhas
  (unidade, ordem, nome, cpf, email, celular, ativa, updated_by, updated_by_nome)
select u.unidade, t.ordem, t.nome, t.cpf, t.email, t.celular, true, t.updated_by, t.updated_by_nome
from public.contrato_testemunhas t
cross join (values ('CEC Baby'), ('Núcleo Belvedere'), ('Núcleo Vale do Sereno')) as u (unidade)
where t.unidade = 'CEC' and t.ativa
  and not exists (
    select 1 from public.contrato_testemunhas x
    where x.unidade = u.unidade and x.ordem = t.ordem and x.ativa
  );

alter table public.contrato_testemunhas alter column unidade drop default;

create unique index if not exists contrato_testemunhas_unidade_ordem_ativa_idx
  on public.contrato_testemunhas (unidade, ordem) where ativa;
