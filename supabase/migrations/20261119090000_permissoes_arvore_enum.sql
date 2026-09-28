-- Permissões em árvore (Grupo > Módulo > Página): passo 1/2 — valores novos do enum.
--
-- Caminho aditivo de menor risco: mantém user_permissions.module como enum
-- app_module e só ACRESCENTA os rótulos das páginas (chaves com ponto). Nada é
-- removido, nenhuma linha é alterada. Precisa ficar em arquivo separado da
-- cópia (20261119090100) porque o PostgreSQL não permite usar um valor de enum
-- na mesma transação em que ele foi criado.
--
-- Gerado por: npx tsx scripts/permissoes-arvore/gerar-migration.ts enum

ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'agenda.mes';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'agenda.semana';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'eformulario';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'matricula.alunos';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'matricula.contratos';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'matricula.campanhas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'secretaria.turmas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'secretaria.disciplinas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'secretaria.atribuicoes';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'secretaria.horarios';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'secretaria.calendario';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'secretaria.notas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'diario.registro';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'diario.extras';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'diario.auditoria';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'diario.faturamento';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'colonia.registro';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'colonia.fechamento';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'uniformes.estoque';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'uniformes.vendas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'biblioteca.circulacao';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'biblioteca.acervo';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'biblioteca.pendencias';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.pessoal.efetivos';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.pessoal.terceirizados';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.pagamentos.salario';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.pagamentos.vt';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.pagamentos.folhas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.contracheques';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.ponto';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.estatistica';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'rh.aniversarios';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'tasks.tickets.recebidas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'tasks.tickets.enviadas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'tasks.planner';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'atendimento';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'assistente_ia.instrucoes';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'assistente_ia.exemplos';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'documentos.gerar.individual';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'documentos.gerar.lote';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'documentos.historico';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'documentos.zapsign';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'mensagens.cobrancas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'mensagens.lembretes';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'mensagens.rematricula';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'mensagens.falhas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'analises_ia';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'extrato';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'importar';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'faturamento';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'fluxo';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'investimentos';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'cartao';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'inadimplencia';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'regua.cobrancas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'regua.historico';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.despesas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.receitas';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.regras';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.cadastros.valor_material';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.cadastros.valor_matricula';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.cadastros.valor_pacotes';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.cadastros.valor_diario';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.cadastros.valor_colonia';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.cadastros.valor_biblioteca';
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'configuracoes.colegios';
