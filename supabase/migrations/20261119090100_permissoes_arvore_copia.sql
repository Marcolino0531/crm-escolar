-- Permissões em árvore (Grupo > Módulo > Página): passo 2/2.
-- Toda a migration roda numa única transação (BEGIN/COMMIT): ou aplica
-- inteira, ou nada. Ordem de publicação: 20261119090000 (enum) → esta → merge/deploy.
--
-- (a) permissoes_folhas(): lista das FOLHAS da árvore (CHAVES_PERMISSAO_GRAVAVEIS,
--     gerada de src/lib/permissoes-arvore.ts). can_view_pagina / can_edit_pagina
--     só consideram linhas de user_permissions cuja chave é folha; a chave pedida
--     casa por igualdade OU por prefixo literal "chave." (left(), sem LIKE — "_" e
--     "%" não são curingas). Linhas com chave antiga (agenda, rh, diario, ...) ou
--     de nó não-folha NÃO contam: módulo/grupo = derivado só das folhas descendentes.
-- (b) Cópia aditiva: para cada usuário, cria as linhas das folhas a partir das
--     chaves antigas (Visualizar/Editar copiados; Editar implica Visualizar).
--     As linhas antigas continuam no banco, mas não são mais lidas por nada.
-- (c) Reescrita de TODAS as policies RLS de produção que chamavam
--     can_view_module/can_edit_module: passam a checar página(s) com legado
--     exatamente igual ao módulo antigo (equivalência 1:1 no dia da cópia).
--     'cobranca' (chave removida em 20260623120100, sem linhas) -> só admin.
-- (d) Funções auxiliares (pedagógico, esportes) reescritas sobre can_*_pagina.
-- (e) can_view_module / can_edit_module são REMOVIDAS: se alguma policy ou
--     função ainda as referenciar, o DROP falha e a transação inteira volta.
--
-- Gerado por: npx tsx scripts/permissoes-arvore/gerar-migration.ts folhas|copia
-- (blocos a/b) e ~/perm_gerar_policies.py sobre pg_policies de produção (bloco c).

BEGIN;

-- ---------- (a) funções ----------

CREATE OR REPLACE FUNCTION public.permissoes_folhas()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY[
    'dashboard',
    'agenda.mes',
    'agenda.semana',
    'admissoes',
    'eformulario',
    'matricula.alunos',
    'matricula.contratos',
    'matricula.campanhas',
    'onboarding',
    'secretaria.turmas',
    'secretaria.disciplinas',
    'secretaria.atribuicoes',
    'secretaria.horarios',
    'secretaria.calendario',
    'secretaria.notas',
    'diario.registro',
    'diario.extras',
    'diario.auditoria',
    'diario.faturamento',
    'colonia.registro',
    'colonia.fechamento',
    'uniformes.estoque',
    'uniformes.vendas',
    'estoque_material',
    'esportes',
    'biblioteca.circulacao',
    'biblioteca.acervo',
    'biblioteca.pendencias',
    'rh.pessoal.efetivos',
    'rh.pessoal.terceirizados',
    'rh.pagamentos.salario',
    'rh.pagamentos.vt',
    'rh.pagamentos.folhas',
    'rh.contracheques',
    'rh.ponto',
    'rh.estatistica',
    'rh.aniversarios',
    'tasks.tickets.recebidas',
    'tasks.tickets.enviadas',
    'tasks.planner',
    'atendimento',
    'assistente_ia.instrucoes',
    'assistente_ia.exemplos',
    'documentos.gerar.individual',
    'documentos.gerar.lote',
    'documentos.historico',
    'documentos.zapsign',
    'cantina',
    'mensagens.cobrancas',
    'mensagens.lembretes',
    'mensagens.rematricula',
    'mensagens.falhas',
    'analises_ia',
    'extrato',
    'importar',
    'faturamento',
    'fluxo',
    'investimentos',
    'cartao',
    'inadimplencia',
    'regua.cobrancas',
    'regua.historico',
    'configuracoes.despesas',
    'configuracoes.receitas',
    'configuracoes.regras',
    'configuracoes.cadastros.valor_material',
    'configuracoes.cadastros.valor_matricula',
    'configuracoes.cadastros.valor_pacotes',
    'configuracoes.cadastros.valor_diario',
    'configuracoes.cadastros.valor_colonia',
    'configuracoes.cadastros.valor_biblioteca',
    'configuracoes.colegios'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.can_view_pagina(_user_id uuid, _chave text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = _user_id
        AND module::text = ANY (public.permissoes_folhas())
        AND (module::text = _chave
             OR left(module::text, length(_chave) + 1) = _chave || '.')
        AND (can_view OR can_edit)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_pagina(_user_id uuid, _chave text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = _user_id
        AND module::text = ANY (public.permissoes_folhas())
        AND (module::text = _chave
             OR left(module::text, length(_chave) + 1) = _chave || '.')
        AND can_edit
    );
$$;

REVOKE ALL ON FUNCTION public.permissoes_folhas() FROM public;
REVOKE EXECUTE ON FUNCTION public.permissoes_folhas() FROM anon;
GRANT EXECUTE ON FUNCTION public.permissoes_folhas() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_view_pagina(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.can_edit_pagina(uuid, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.can_view_pagina(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_pagina(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_pagina(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_pagina(uuid, text) TO authenticated, service_role;

-- ---------- (b) cópia aditiva legado -> folhas ----------

WITH legado AS (
  SELECT user_id,
    bool_or(module = 'dashboard' AND (can_view OR can_edit)) AS ver_dashboard,
    bool_or(module = 'dashboard' AND can_edit) AS edit_dashboard,
    bool_or(module = 'agenda' AND (can_view OR can_edit)) AS ver_agenda,
    bool_or(module = 'agenda' AND can_edit) AS edit_agenda,
    bool_or(module = 'admissoes' AND (can_view OR can_edit)) AS ver_admissoes,
    bool_or(module = 'admissoes' AND can_edit) AS edit_admissoes,
    bool_or(module = 'onboarding' AND (can_view OR can_edit)) AS ver_onboarding,
    bool_or(module = 'onboarding' AND can_edit) AS edit_onboarding,
    bool_or(module = 'rh' AND (can_view OR can_edit)) AS ver_rh,
    bool_or(module = 'rh' AND can_edit) AS edit_rh,
    bool_or(module = 'rh_salario' AND (can_view OR can_edit)) AS ver_rh_salario,
    bool_or(module = 'rh_salario' AND can_edit) AS edit_rh_salario,
    bool_or(module = 'tasks' AND (can_view OR can_edit)) AS ver_tasks,
    bool_or(module = 'tasks' AND can_edit) AS edit_tasks,
    bool_or(module = 'uniformes' AND (can_view OR can_edit)) AS ver_uniformes,
    bool_or(module = 'uniformes' AND can_edit) AS edit_uniformes,
    bool_or(module = 'estoque_material' AND (can_view OR can_edit)) AS ver_estoque_material,
    bool_or(module = 'estoque_material' AND can_edit) AS edit_estoque_material,
    bool_or(module = 'diario' AND (can_view OR can_edit)) AS ver_diario,
    bool_or(module = 'diario' AND can_edit) AS edit_diario,
    bool_or(module = 'diario_financeiro' AND (can_view OR can_edit)) AS ver_diario_financeiro,
    bool_or(module = 'diario_financeiro' AND can_edit) AS edit_diario_financeiro,
    bool_or(module = 'colonia' AND (can_view OR can_edit)) AS ver_colonia,
    bool_or(module = 'colonia' AND can_edit) AS edit_colonia,
    bool_or(module = 'colonia_financeiro' AND (can_view OR can_edit)) AS ver_colonia_financeiro,
    bool_or(module = 'colonia_financeiro' AND can_edit) AS edit_colonia_financeiro,
    bool_or(module = 'esportes' AND (can_view OR can_edit)) AS ver_esportes,
    bool_or(module = 'esportes' AND can_edit) AS edit_esportes,
    bool_or(module = 'biblioteca' AND (can_view OR can_edit)) AS ver_biblioteca,
    bool_or(module = 'biblioteca' AND can_edit) AS edit_biblioteca,
    bool_or(module = 'pedagogico' AND (can_view OR can_edit)) AS ver_pedagogico,
    bool_or(module = 'pedagogico' AND can_edit) AS edit_pedagogico,
    bool_or(module = 'documentos' AND (can_view OR can_edit)) AS ver_documentos,
    bool_or(module = 'documentos' AND can_edit) AS edit_documentos,
    bool_or(module = 'cantina' AND (can_view OR can_edit)) AS ver_cantina,
    bool_or(module = 'cantina' AND can_edit) AS edit_cantina,
    bool_or(module = 'rematricula' AND (can_view OR can_edit)) AS ver_rematricula,
    bool_or(module = 'rematricula' AND can_edit) AS edit_rematricula,
    bool_or(module = 'financeiro' AND (can_view OR can_edit)) AS ver_financeiro,
    bool_or(module = 'financeiro' AND can_edit) AS edit_financeiro,
    bool_or(module = 'configuracoes' AND (can_view OR can_edit)) AS ver_configuracoes,
    bool_or(module = 'configuracoes' AND can_edit) AS edit_configuracoes,
    bool_or(module = 'financeiro_dashboard' AND (can_view OR can_edit)) AS ver_financeiro_dashboard,
    bool_or(module = 'financeiro_dashboard' AND can_edit) AS edit_financeiro_dashboard,
    bool_or(module = 'financeiro_upload' AND (can_view OR can_edit)) AS ver_financeiro_upload,
    bool_or(module = 'financeiro_upload' AND can_edit) AS edit_financeiro_upload,
    bool_or(module = 'financeiro_conciliacao' AND (can_view OR can_edit)) AS ver_financeiro_conciliacao,
    bool_or(module = 'financeiro_conciliacao' AND can_edit) AS edit_financeiro_conciliacao,
    bool_or(module = 'financeiro_fluxo' AND (can_view OR can_edit)) AS ver_financeiro_fluxo,
    bool_or(module = 'financeiro_fluxo' AND can_edit) AS edit_financeiro_fluxo,
    bool_or(module = 'financeiro_inadimplencia' AND (can_view OR can_edit)) AS ver_financeiro_inadimplencia,
    bool_or(module = 'financeiro_inadimplencia' AND can_edit) AS edit_financeiro_inadimplencia,
    bool_or(module = 'financeiro_cobranca' AND (can_view OR can_edit)) AS ver_financeiro_cobranca,
    bool_or(module = 'financeiro_cobranca' AND can_edit) AS edit_financeiro_cobranca,
    bool_or(module = 'financeiro_atendimento' AND (can_view OR can_edit)) AS ver_financeiro_atendimento,
    bool_or(module = 'financeiro_atendimento' AND can_edit) AS edit_financeiro_atendimento,
    bool_or(module = 'financeiro_atendimento_ia' AND (can_view OR can_edit)) AS ver_financeiro_atendimento_ia,
    bool_or(module = 'financeiro_atendimento_ia' AND can_edit) AS edit_financeiro_atendimento_ia,
    bool_or(module = 'financeiro_cartao' AND (can_view OR can_edit)) AS ver_financeiro_cartao,
    bool_or(module = 'financeiro_cartao' AND can_edit) AS edit_financeiro_cartao,
    bool_or(module = 'financeiro_fundos' AND (can_view OR can_edit)) AS ver_financeiro_fundos,
    bool_or(module = 'financeiro_fundos' AND can_edit) AS edit_financeiro_fundos
  FROM public.user_permissions
  GROUP BY user_id
), novas AS (
  SELECT l.user_id, 'agenda.mes'::public.app_module AS module,
         COALESCE(((l.ver_agenda)), false) AS can_view,
         (COALESCE(((l.ver_agenda)), false)) AND (COALESCE(((l.edit_agenda)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'agenda.semana'::public.app_module AS module,
         COALESCE(((l.ver_agenda)), false) AS can_view,
         (COALESCE(((l.ver_agenda)), false)) AND (COALESCE(((l.edit_agenda)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'eformulario'::public.app_module AS module,
         COALESCE(((l.ver_admissoes)), false) AS can_view,
         (COALESCE(((l.ver_admissoes)), false)) AND (COALESCE(((l.edit_admissoes)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'matricula.alunos'::public.app_module AS module,
         COALESCE(((l.ver_rematricula)), false) AS can_view,
         (COALESCE(((l.ver_rematricula)), false)) AND (COALESCE(((l.edit_rematricula)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'matricula.contratos'::public.app_module AS module,
         COALESCE(((l.ver_rematricula)), false) AS can_view,
         (COALESCE(((l.ver_rematricula)), false)) AND (COALESCE(((l.edit_rematricula)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'matricula.campanhas'::public.app_module AS module,
         COALESCE(((l.ver_rematricula)), false) AS can_view,
         (COALESCE(((l.ver_rematricula)), false)) AND (COALESCE(((l.edit_rematricula)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'secretaria.turmas'::public.app_module AS module,
         COALESCE(((l.ver_pedagogico)), false) AS can_view,
         (COALESCE(((l.ver_pedagogico)), false)) AND (COALESCE(((l.edit_pedagogico)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'secretaria.disciplinas'::public.app_module AS module,
         COALESCE(((l.ver_pedagogico)), false) AS can_view,
         (COALESCE(((l.ver_pedagogico)), false)) AND (COALESCE(((l.edit_pedagogico)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'secretaria.atribuicoes'::public.app_module AS module,
         COALESCE(((l.ver_pedagogico)), false) AS can_view,
         (COALESCE(((l.ver_pedagogico)), false)) AND (COALESCE(((l.edit_pedagogico)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'secretaria.horarios'::public.app_module AS module,
         COALESCE(((l.ver_pedagogico)), false) AS can_view,
         (COALESCE(((l.ver_pedagogico)), false)) AND (COALESCE(((l.edit_pedagogico)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'secretaria.calendario'::public.app_module AS module,
         COALESCE(((l.ver_pedagogico)), false) AS can_view,
         (COALESCE(((l.ver_pedagogico)), false)) AND (COALESCE(((l.edit_pedagogico)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'secretaria.notas'::public.app_module AS module,
         COALESCE(((l.ver_pedagogico)), false) AS can_view,
         (COALESCE(((l.ver_pedagogico)), false)) AND (COALESCE(((l.edit_pedagogico)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'diario.registro'::public.app_module AS module,
         COALESCE(((l.ver_diario)), false) AS can_view,
         (COALESCE(((l.ver_diario)), false)) AND (COALESCE(((l.edit_diario)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'diario.extras'::public.app_module AS module,
         COALESCE(((l.ver_diario)), false) AS can_view,
         (COALESCE(((l.ver_diario)), false)) AND (COALESCE(((l.edit_diario)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'diario.auditoria'::public.app_module AS module,
         COALESCE(((l.ver_diario_financeiro)), false) AS can_view,
         (COALESCE(((l.ver_diario_financeiro)), false)) AND (COALESCE(((l.edit_diario_financeiro)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'diario.faturamento'::public.app_module AS module,
         COALESCE(((l.ver_diario_financeiro)), false) AS can_view,
         (COALESCE(((l.ver_diario_financeiro)), false)) AND (COALESCE(((l.edit_diario_financeiro)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'colonia.registro'::public.app_module AS module,
         COALESCE(((l.ver_colonia)), false) AS can_view,
         (COALESCE(((l.ver_colonia)), false)) AND (COALESCE(((l.edit_colonia)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'colonia.fechamento'::public.app_module AS module,
         COALESCE(((l.ver_colonia_financeiro)), false) AS can_view,
         (COALESCE(((l.ver_colonia_financeiro)), false)) AND (COALESCE(((l.edit_colonia)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'uniformes.estoque'::public.app_module AS module,
         COALESCE(((l.ver_uniformes)), false) AS can_view,
         (COALESCE(((l.ver_uniformes)), false)) AND (COALESCE(((l.edit_uniformes)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'uniformes.vendas'::public.app_module AS module,
         COALESCE(((l.ver_uniformes)), false) AS can_view,
         (COALESCE(((l.ver_uniformes)), false)) AND (COALESCE(((l.edit_uniformes)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'biblioteca.circulacao'::public.app_module AS module,
         COALESCE(((l.ver_biblioteca)), false) AS can_view,
         (COALESCE(((l.ver_biblioteca)), false)) AND (COALESCE(((l.edit_biblioteca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'biblioteca.acervo'::public.app_module AS module,
         COALESCE(((l.ver_biblioteca)), false) AS can_view,
         (COALESCE(((l.ver_biblioteca)), false)) AND (COALESCE(((l.edit_biblioteca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'biblioteca.pendencias'::public.app_module AS module,
         COALESCE(((l.ver_biblioteca)), false) AS can_view,
         (COALESCE(((l.ver_biblioteca)), false)) AND (COALESCE(((l.edit_biblioteca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'rh.pessoal.efetivos'::public.app_module AS module,
         COALESCE(((l.ver_rh)), false) AS can_view,
         (COALESCE(((l.ver_rh)), false)) AND (COALESCE(((l.edit_rh)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'rh.pessoal.terceirizados'::public.app_module AS module,
         COALESCE(((l.ver_rh)), false) AS can_view,
         (COALESCE(((l.ver_rh)), false)) AND (COALESCE(((l.edit_rh)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'rh.pagamentos.salario'::public.app_module AS module,
         COALESCE(((l.ver_rh_salario)), false) AS can_view,
         (COALESCE(((l.ver_rh_salario)), false)) AND (COALESCE(((l.edit_rh_salario)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'rh.pagamentos.vt'::public.app_module AS module,
         COALESCE(((l.ver_rh)), false) AS can_view,
         (COALESCE(((l.ver_rh)), false)) AND (COALESCE(((l.edit_rh)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'rh.pagamentos.folhas'::public.app_module AS module,
         COALESCE(((l.ver_rh)), false) AS can_view,
         (COALESCE(((l.ver_rh)), false)) AND (COALESCE(((l.edit_rh)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'rh.contracheques'::public.app_module AS module,
         COALESCE(((l.ver_rh)), false) AS can_view,
         (COALESCE(((l.ver_rh)), false)) AND (COALESCE(((l.edit_rh)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'rh.ponto'::public.app_module AS module,
         COALESCE(((l.ver_rh)), false) AS can_view,
         (COALESCE(((l.ver_rh)), false)) AND (COALESCE(((l.edit_rh)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'rh.estatistica'::public.app_module AS module,
         COALESCE(((l.ver_rh)), false) AS can_view,
         (COALESCE(((l.ver_rh)), false)) AND (COALESCE(((l.edit_rh)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'rh.aniversarios'::public.app_module AS module,
         COALESCE(((l.ver_rh)), false) AS can_view,
         (COALESCE(((l.ver_rh)), false)) AND (COALESCE(((l.edit_rh)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'tasks.tickets.recebidas'::public.app_module AS module,
         COALESCE(((l.ver_tasks)), false) AS can_view,
         (COALESCE(((l.ver_tasks)), false)) AND (COALESCE(((l.edit_tasks)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'tasks.tickets.enviadas'::public.app_module AS module,
         COALESCE(((l.ver_tasks)), false) AS can_view,
         (COALESCE(((l.ver_tasks)), false)) AND (COALESCE(((l.edit_tasks)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'tasks.planner'::public.app_module AS module,
         COALESCE(((l.ver_tasks)), false) AS can_view,
         (COALESCE(((l.ver_tasks)), false)) AND (COALESCE(((l.edit_tasks)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'atendimento'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_atendimento)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_atendimento)), false)) AND (COALESCE(((l.edit_financeiro_atendimento)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'assistente_ia.instrucoes'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_atendimento_ia)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_atendimento_ia)), false)) AND (COALESCE(((l.edit_financeiro_atendimento_ia)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'assistente_ia.exemplos'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_atendimento_ia)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_atendimento_ia)), false)) AND (COALESCE(((l.edit_financeiro_atendimento_ia)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'documentos.gerar.individual'::public.app_module AS module,
         COALESCE(((l.ver_documentos)), false) AS can_view,
         (COALESCE(((l.ver_documentos)), false)) AND (COALESCE(((l.edit_documentos)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'documentos.gerar.lote'::public.app_module AS module,
         COALESCE(((l.ver_documentos)), false) AS can_view,
         (COALESCE(((l.ver_documentos)), false)) AND (COALESCE(((l.edit_documentos)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'documentos.historico'::public.app_module AS module,
         COALESCE(((l.ver_documentos)), false) AS can_view,
         (COALESCE(((l.ver_documentos)), false)) AND (COALESCE(((l.edit_documentos)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'documentos.zapsign'::public.app_module AS module,
         COALESCE(((l.ver_documentos)), false) AS can_view,
         (COALESCE(((l.ver_documentos)), false)) AND (COALESCE(((l.edit_documentos)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'mensagens.cobrancas'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_cobranca)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_cobranca)), false)) AND (COALESCE(((l.edit_financeiro_cobranca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'mensagens.lembretes'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_cobranca)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_cobranca)), false)) AND (COALESCE(((l.edit_financeiro_cobranca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'mensagens.rematricula'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_cobranca)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_cobranca)), false)) AND (COALESCE(((l.edit_financeiro_cobranca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'mensagens.falhas'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_cobranca)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_cobranca)), false)) AND (COALESCE(((l.edit_financeiro_cobranca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'analises_ia'::public.app_module AS module,
         COALESCE(((l.ver_financeiro)), false) AS can_view,
         (COALESCE(((l.ver_financeiro)), false)) AND (COALESCE(((l.edit_financeiro)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'extrato'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_dashboard)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_dashboard)), false)) AND (COALESCE(((l.edit_financeiro)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'importar'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_upload)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_upload)), false)) AND (COALESCE(((l.edit_financeiro_upload)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'faturamento'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_conciliacao)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_conciliacao)), false)) AND (COALESCE(((l.edit_financeiro)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'fluxo'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_fluxo)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_fluxo)), false)) AND (COALESCE(((l.edit_financeiro)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'investimentos'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_fundos)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_fundos)), false)) AND (COALESCE(((l.edit_financeiro_fundos)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'cartao'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_cartao)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_cartao)), false)) AND (COALESCE(((l.edit_financeiro_cartao)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'inadimplencia'::public.app_module AS module,
         COALESCE(((l.ver_financeiro_inadimplencia)), false) AS can_view,
         (COALESCE(((l.ver_financeiro_inadimplencia)), false)) AND (COALESCE(((l.edit_financeiro_inadimplencia)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'regua.cobrancas'::public.app_module AS module,
         COALESCE(((l.ver_financeiro) AND (l.ver_financeiro_cobranca)), false) AS can_view,
         (COALESCE(((l.ver_financeiro) AND (l.ver_financeiro_cobranca)), false)) AND (COALESCE(((l.edit_financeiro_cobranca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'regua.historico'::public.app_module AS module,
         COALESCE(((l.ver_financeiro) AND (l.ver_financeiro_cobranca)), false) AS can_view,
         (COALESCE(((l.ver_financeiro) AND (l.ver_financeiro_cobranca)), false)) AND (COALESCE(((l.edit_financeiro_cobranca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.despesas'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes)), false)) AND (COALESCE(((l.edit_configuracoes)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.receitas'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes)), false)) AND (COALESCE(((l.edit_configuracoes)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.regras'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes)), false)) AND (COALESCE(((l.edit_configuracoes)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.cadastros.valor_material'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes) AND (l.ver_rematricula)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes) AND (l.ver_rematricula)), false)) AND (COALESCE(((l.edit_rematricula)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.cadastros.valor_matricula'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes) AND (l.ver_rematricula)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes) AND (l.ver_rematricula)), false)) AND (COALESCE(((l.edit_rematricula)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.cadastros.valor_pacotes'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes) AND (l.ver_rematricula)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes) AND (l.ver_rematricula)), false)) AND (COALESCE(((l.edit_rematricula)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.cadastros.valor_diario'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes) AND (l.ver_diario_financeiro)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes) AND (l.ver_diario_financeiro)), false)) AND (COALESCE(((l.edit_diario_financeiro)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.cadastros.valor_colonia'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes) AND (l.ver_colonia)) OR ((l.ver_configuracoes) AND (l.ver_colonia_financeiro)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes) AND (l.ver_colonia)) OR ((l.ver_configuracoes) AND (l.ver_colonia_financeiro)), false)) AND (COALESCE(((l.edit_colonia_financeiro)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.cadastros.valor_biblioteca'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes) AND (l.ver_biblioteca)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes) AND (l.ver_biblioteca)), false)) AND (COALESCE(((l.edit_biblioteca)), false)) AS can_edit
  FROM legado l
  UNION ALL
  SELECT l.user_id, 'configuracoes.colegios'::public.app_module AS module,
         COALESCE(((l.ver_configuracoes) AND (l.ver_documentos)), false) AS can_view,
         (COALESCE(((l.ver_configuracoes) AND (l.ver_documentos)), false)) AND (COALESCE(((l.edit_documentos)), false)) AS can_edit
  FROM legado l
)
INSERT INTO public.user_permissions (user_id, module, can_view, can_edit)
SELECT user_id, module, can_view OR can_edit, can_edit FROM novas
WHERE can_view OR can_edit
ON CONFLICT (user_id, module) DO NOTHING;

-- ---------- (c) policies RLS por página ----------

ALTER POLICY "agenda delete agenda_colaboradores" ON public.agenda_colaboradores
  USING ((public.can_edit_pagina(auth.uid(), 'agenda.mes') OR public.can_edit_pagina(auth.uid(), 'agenda.semana')));

ALTER POLICY "agenda insert agenda_colaboradores" ON public.agenda_colaboradores
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'agenda.mes') OR public.can_edit_pagina(auth.uid(), 'agenda.semana')));

ALTER POLICY "agenda update agenda_colaboradores" ON public.agenda_colaboradores
  USING ((public.can_edit_pagina(auth.uid(), 'agenda.mes') OR public.can_edit_pagina(auth.uid(), 'agenda.semana')))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'agenda.mes') OR public.can_edit_pagina(auth.uid(), 'agenda.semana')));

ALTER POLICY "agenda view agenda_colaboradores" ON public.agenda_colaboradores
  USING ((public.can_view_pagina(auth.uid(), 'agenda.mes') OR public.can_view_pagina(auth.uid(), 'agenda.semana')));

ALTER POLICY "agenda delete agenda_reunioes" ON public.agenda_reunioes
  USING ((public.can_edit_pagina(auth.uid(), 'agenda.mes') OR public.can_edit_pagina(auth.uid(), 'agenda.semana')));

ALTER POLICY "agenda insert agenda_reunioes" ON public.agenda_reunioes
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'agenda.mes') OR public.can_edit_pagina(auth.uid(), 'agenda.semana')));

ALTER POLICY "agenda update agenda_reunioes" ON public.agenda_reunioes
  USING (((public.can_edit_pagina(auth.uid(), 'agenda.mes') OR public.can_edit_pagina(auth.uid(), 'agenda.semana')) AND (created_by = auth.uid())))
  WITH CHECK (((public.can_edit_pagina(auth.uid(), 'agenda.mes') OR public.can_edit_pagina(auth.uid(), 'agenda.semana')) AND (created_by = auth.uid())));

ALTER POLICY "agenda view agenda_reunioes" ON public.agenda_reunioes
  USING ((public.can_view_pagina(auth.uid(), 'agenda.mes') OR public.can_view_pagina(auth.uid(), 'agenda.semana')));

ALTER POLICY "atendimento ia view ai_atendimento_settings" ON public.ai_atendimento_settings
  USING ((public.can_view_pagina(auth.uid(), 'assistente_ia.instrucoes') OR public.can_view_pagina(auth.uid(), 'assistente_ia.exemplos')));

ALTER POLICY "analises ia financeiro view" ON public.ai_financeiro_analises
  USING (public.can_view_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "atendimento ia view ai_suggestions" ON public.ai_suggestions
  USING ((public.can_view_pagina(auth.uid(), 'assistente_ia.instrucoes') OR public.can_view_pagina(auth.uid(), 'assistente_ia.exemplos')));

ALTER POLICY "atendimento ia view ai_training_examples" ON public.ai_training_examples
  USING ((public.can_view_pagina(auth.uid(), 'assistente_ia.instrucoes') OR public.can_view_pagina(auth.uid(), 'assistente_ia.exemplos')));

ALTER POLICY "biblioteca edit biblioteca_emprestimos" ON public.biblioteca_emprestimos
  USING ((public.can_edit_pagina(auth.uid(), 'biblioteca.circulacao') AND can_access_school(auth.uid(), school_id)))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'biblioteca.circulacao') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "biblioteca view biblioteca_emprestimos" ON public.biblioteca_emprestimos
  USING (((public.can_view_pagina(auth.uid(), 'biblioteca.circulacao') OR public.can_view_pagina(auth.uid(), 'biblioteca.acervo') OR public.can_view_pagina(auth.uid(), 'biblioteca.pendencias')) AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "biblioteca edit biblioteca_exemplares" ON public.biblioteca_exemplares
  USING ((public.can_edit_pagina(auth.uid(), 'biblioteca.acervo') AND can_access_school(auth.uid(), school_id)))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'biblioteca.acervo') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "biblioteca view biblioteca_exemplares" ON public.biblioteca_exemplares
  USING (((public.can_view_pagina(auth.uid(), 'biblioteca.circulacao') OR public.can_view_pagina(auth.uid(), 'biblioteca.acervo') OR public.can_view_pagina(auth.uid(), 'biblioteca.pendencias')) AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "biblioteca edit biblioteca_titulos" ON public.biblioteca_titulos
  USING ((public.can_edit_pagina(auth.uid(), 'biblioteca.acervo') AND can_access_school(auth.uid(), school_id)))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'biblioteca.acervo') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "biblioteca view biblioteca_titulos" ON public.biblioteca_titulos
  USING (((public.can_view_pagina(auth.uid(), 'biblioteca.circulacao') OR public.can_view_pagina(auth.uid(), 'biblioteca.acervo') OR public.can_view_pagina(auth.uid(), 'biblioteca.pendencias')) AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "biblioteca view biblioteca_valores" ON public.biblioteca_valores
  USING (((public.can_view_pagina(auth.uid(), 'configuracoes.cadastros.valor_biblioteca') OR public.can_view_pagina(auth.uid(), 'biblioteca.circulacao') OR public.can_view_pagina(auth.uid(), 'biblioteca.acervo') OR public.can_view_pagina(auth.uid(), 'biblioteca.pendencias')) AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "cfg delete boleto_category_mappings" ON public.boleto_category_mappings
  USING (public.can_edit_pagina(auth.uid(), 'configuracoes.regras'));

ALTER POLICY "cfg insert boleto_category_mappings" ON public.boleto_category_mappings
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'configuracoes.regras'));

ALTER POLICY "cfg update boleto_category_mappings" ON public.boleto_category_mappings
  USING (public.can_edit_pagina(auth.uid(), 'configuracoes.regras'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'configuracoes.regras'));

ALTER POLICY "cfg view boleto_category_mappings" ON public.boleto_category_mappings
  USING ((public.can_view_pagina(auth.uid(), 'analises_ia') OR public.can_view_pagina(auth.uid(), 'configuracoes.regras')));

ALTER POLICY "fin delete boleto_reconciliation_items" ON public.boleto_reconciliation_items
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin insert boleto_reconciliation_items" ON public.boleto_reconciliation_items
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin update boleto_reconciliation_items" ON public.boleto_reconciliation_items
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin view boleto_reconciliation_items" ON public.boleto_reconciliation_items
  USING (public.can_view_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin delete boleto_reconciliations" ON public.boleto_reconciliations
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin insert boleto_reconciliations" ON public.boleto_reconciliations
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin update boleto_reconciliations" ON public.boleto_reconciliations
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin view boleto_reconciliations" ON public.boleto_reconciliations
  USING (public.can_view_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "cantina_portal_config_select" ON public.cantina_portal_config
  USING (public.can_view_pagina(auth.uid(), 'cantina'));

ALTER POLICY "cantina recargas select" ON public.cantina_recargas
  USING (public.can_view_pagina(auth.uid(), 'cantina'));

ALTER POLICY "cantina recargas update" ON public.cantina_recargas
  USING (public.can_edit_pagina(auth.uid(), 'cantina'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'cantina'));

ALTER POLICY "ref delete categorization_rules" ON public.categorization_rules
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.regras') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref insert categorization_rules" ON public.categorization_rules
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.regras') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref update categorization_rules" ON public.categorization_rules
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.regras') OR public.can_edit_pagina(auth.uid(), 'analises_ia')))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.regras') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "colonia view colonia_valores" ON public.colonia_valores
  USING (((public.can_view_pagina(auth.uid(), 'configuracoes.cadastros.valor_colonia') OR public.can_view_pagina(auth.uid(), 'colonia.registro')) OR (public.can_view_pagina(auth.uid(), 'configuracoes.cadastros.valor_colonia') OR public.can_view_pagina(auth.uid(), 'colonia.fechamento'))));

ALTER POLICY "contrato testemunhas select" ON public.contrato_testemunhas
  USING ((public.can_view_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_view_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_view_pagina(auth.uid(), 'documentos.historico') OR public.can_view_pagina(auth.uid(), 'documentos.zapsign')));

ALTER POLICY "contrato testemunhas update" ON public.contrato_testemunhas
  USING ((public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_edit_pagina(auth.uid(), 'documentos.historico') OR public.can_edit_pagina(auth.uid(), 'documentos.zapsign')))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_edit_pagina(auth.uid(), 'documentos.historico') OR public.can_edit_pagina(auth.uid(), 'documentos.zapsign')));

ALTER POLICY "contratos_matricula read" ON public.contratos_matricula
  USING (public.can_view_pagina(auth.uid(), 'matricula.contratos'));

ALTER POLICY "ref delete cost_centers" ON public.cost_centers
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.despesas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref insert cost_centers" ON public.cost_centers
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.despesas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref update cost_centers" ON public.cost_centers
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.despesas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.despesas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "cartao delete" ON public.credit_card_receivables
  USING (public.can_edit_pagina(auth.uid(), 'cartao'));

ALTER POLICY "cartao insert" ON public.credit_card_receivables
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'cartao'));

ALTER POLICY "cartao update" ON public.credit_card_receivables
  USING (public.can_edit_pagina(auth.uid(), 'cartao'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'cartao'));

ALTER POLICY "cartao view" ON public.credit_card_receivables
  USING (public.can_view_pagina(auth.uid(), 'cartao'));

ALTER POLICY "diario view diario_auditoria_execucoes" ON public.diario_auditoria_execucoes
  USING ((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')));

ALTER POLICY "diario view diario_auditoria_inconsistencias" ON public.diario_auditoria_inconsistencias
  USING ((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')));

ALTER POLICY "diario delete diario_classes" ON public.diario_classes
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario insert diario_classes" ON public.diario_classes
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario update diario_classes" ON public.diario_classes
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario/colonia view diario_classes" ON public.diario_classes
  USING (((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')) OR public.can_view_pagina(auth.uid(), 'colonia.registro') OR public.can_view_pagina(auth.uid(), 'colonia.fechamento')));

ALTER POLICY "diario delete diario_events" ON public.diario_events
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario insert diario_events" ON public.diario_events
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'diario.registro') AND (recorded_by = auth.uid())));

ALTER POLICY "diario update diario_events" ON public.diario_events
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario view diario_events" ON public.diario_events
  USING ((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')));

ALTER POLICY "diario view diario_faturamentos" ON public.diario_faturamentos
  USING ((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')));

ALTER POLICY "diario view diario_matriculas_ano" ON public.diario_matriculas_ano
  USING ((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')));

ALTER POLICY "diario delete diario_meal_plans" ON public.diario_meal_plans
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario insert diario_meal_plans" ON public.diario_meal_plans
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario update diario_meal_plans" ON public.diario_meal_plans
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario view diario_meal_plans" ON public.diario_meal_plans
  USING ((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')));

ALTER POLICY "diario view diario_precos_extras" ON public.diario_precos_extras
  USING ((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')));

ALTER POLICY "diario delete diario_schedules" ON public.diario_schedules
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario insert diario_schedules" ON public.diario_schedules
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario update diario_schedules" ON public.diario_schedules
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario view diario_schedules" ON public.diario_schedules
  USING ((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')));

ALTER POLICY "diario delete diario_students" ON public.diario_students
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario insert diario_students" ON public.diario_students
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario update diario_students" ON public.diario_students
  USING (public.can_edit_pagina(auth.uid(), 'diario.registro'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'diario.registro'));

ALTER POLICY "diario/colonia view diario_students" ON public.diario_students
  USING (((public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras')) OR public.can_view_pagina(auth.uid(), 'colonia.registro') OR public.can_view_pagina(auth.uid(), 'colonia.fechamento')));

ALTER POLICY "documentos colegios insert" ON public.documentos_colegios
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_edit_pagina(auth.uid(), 'documentos.historico') OR public.can_edit_pagina(auth.uid(), 'documentos.zapsign')));

ALTER POLICY "documentos colegios select" ON public.documentos_colegios
  USING ((public.can_view_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_view_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_view_pagina(auth.uid(), 'documentos.historico') OR public.can_view_pagina(auth.uid(), 'documentos.zapsign')));

ALTER POLICY "documentos colegios update" ON public.documentos_colegios
  USING ((public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_edit_pagina(auth.uid(), 'documentos.historico') OR public.can_edit_pagina(auth.uid(), 'documentos.zapsign')))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_edit_pagina(auth.uid(), 'documentos.historico') OR public.can_edit_pagina(auth.uid(), 'documentos.zapsign')));

ALTER POLICY "documentos recibos insert" ON public.documentos_recibos
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.historico')));

ALTER POLICY "documentos recibos select" ON public.documentos_recibos
  USING ((public.can_view_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_view_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_view_pagina(auth.uid(), 'documentos.historico') OR public.can_view_pagina(auth.uid(), 'documentos.zapsign')));

ALTER POLICY "admissoes view enrollment_submissions" ON public.enrollment_submissions
  USING (public.can_view_pagina(auth.uid(), 'eformulario'));

ALTER POLICY "edit delete funcionarios" ON public.funcionarios
  USING ((public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "edit insert funcionarios" ON public.funcionarios
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "edit update funcionarios" ON public.funcionarios
  USING ((public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos') AND can_access_school(auth.uid(), school_id)))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "view funcionarios" ON public.funcionarios
  USING (((public.can_view_pagina(auth.uid(), 'rh.pessoal.efetivos') OR public.can_view_pagina(auth.uid(), 'rh.pessoal.terceirizados') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.vt') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.folhas') OR public.can_view_pagina(auth.uid(), 'rh.contracheques') OR public.can_view_pagina(auth.uid(), 'rh.ponto') OR public.can_view_pagina(auth.uid(), 'rh.estatistica') OR public.can_view_pagina(auth.uid(), 'rh.aniversarios')) AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "rh_salario edit funcionarios_salarios" ON public.funcionarios_salarios
  USING (public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario'));

ALTER POLICY "rh_salario view funcionarios_salarios" ON public.funcionarios_salarios
  USING (public.can_view_pagina(auth.uid(), 'rh.pagamentos.salario'));

ALTER POLICY "colonia_financeiro view holiday_camp_invoices" ON public.holiday_camp_invoices
  USING (public.can_view_pagina(auth.uid(), 'colonia.fechamento'));

ALTER POLICY "colonia delete holiday_camp_records" ON public.holiday_camp_records
  USING (public.can_edit_pagina(auth.uid(), 'colonia.registro'));

ALTER POLICY "colonia insert holiday_camp_records" ON public.holiday_camp_records
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'colonia.registro') AND (recorded_by = auth.uid())));

ALTER POLICY "colonia update holiday_camp_records" ON public.holiday_camp_records
  USING (public.can_edit_pagina(auth.uid(), 'colonia.registro'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'colonia.registro'));

ALTER POLICY "colonia view holiday_camp_records" ON public.holiday_camp_records
  USING ((public.can_view_pagina(auth.uid(), 'colonia.registro') OR public.can_view_pagina(auth.uid(), 'colonia.fechamento')));

ALTER POLICY "colonia view holiday_camp_week_status" ON public.holiday_camp_week_status
  USING ((public.can_view_pagina(auth.uid(), 'colonia.registro') OR public.can_view_pagina(auth.uid(), 'colonia.fechamento')));

ALTER POLICY "hr docs delete" ON public.hr_employee_documents
  USING (public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos'));

ALTER POLICY "hr docs insert" ON public.hr_employee_documents
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos'));

ALTER POLICY "hr docs select" ON public.hr_employee_documents
  USING ((public.can_view_pagina(auth.uid(), 'rh.pessoal.efetivos') OR public.can_view_pagina(auth.uid(), 'rh.pessoal.terceirizados') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.vt') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.folhas') OR public.can_view_pagina(auth.uid(), 'rh.contracheques') OR public.can_view_pagina(auth.uid(), 'rh.ponto') OR public.can_view_pagina(auth.uid(), 'rh.estatistica') OR public.can_view_pagina(auth.uid(), 'rh.aniversarios')));

ALTER POLICY "hr payslip sends select" ON public.hr_payslip_sends
  USING (public.can_view_pagina(auth.uid(), 'rh.contracheques'));

ALTER POLICY "hr timesheet entries select" ON public.hr_timesheet_entries
  USING ((public.can_view_pagina(auth.uid(), 'rh.ponto') OR public.can_view_pagina(auth.uid(), 'rh.estatistica')));

ALTER POLICY "hr timesheets select" ON public.hr_timesheets
  USING ((public.can_view_pagina(auth.uid(), 'rh.ponto') OR public.can_view_pagina(auth.uid(), 'rh.estatistica')));

ALTER POLICY "hr transport items delete" ON public.hr_transport_batch_items
  USING (
CASE hr_batch_tipo(batch_id)
    WHEN 'salario'::text THEN public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE public.can_edit_pagina(auth.uid(), 'rh.pagamentos.vt')
END);

ALTER POLICY "hr transport items insert" ON public.hr_transport_batch_items
  WITH CHECK (
CASE hr_batch_tipo(batch_id)
    WHEN 'salario'::text THEN public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE public.can_edit_pagina(auth.uid(), 'rh.pagamentos.vt')
END);

ALTER POLICY "hr transport items select" ON public.hr_transport_batch_items
  USING (
CASE hr_batch_tipo(batch_id)
    WHEN 'salario'::text THEN public.can_view_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE (public.can_view_pagina(auth.uid(), 'rh.pagamentos.vt') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.folhas'))
END);

ALTER POLICY "hr transport items update" ON public.hr_transport_batch_items
  USING (
CASE hr_batch_tipo(batch_id)
    WHEN 'salario'::text THEN public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE public.can_edit_pagina(auth.uid(), 'rh.pagamentos.vt')
END)
  WITH CHECK (
CASE hr_batch_tipo(batch_id)
    WHEN 'salario'::text THEN public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE public.can_edit_pagina(auth.uid(), 'rh.pagamentos.vt')
END);

ALTER POLICY "hr transport batches delete" ON public.hr_transport_batches
  USING (
CASE tipo
    WHEN 'salario'::text THEN public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE public.can_edit_pagina(auth.uid(), 'rh.pagamentos.vt')
END);

ALTER POLICY "hr transport batches insert" ON public.hr_transport_batches
  WITH CHECK (
CASE tipo
    WHEN 'salario'::text THEN public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE public.can_edit_pagina(auth.uid(), 'rh.pagamentos.vt')
END);

ALTER POLICY "hr transport batches select" ON public.hr_transport_batches
  USING (
CASE tipo
    WHEN 'salario'::text THEN public.can_view_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE (public.can_view_pagina(auth.uid(), 'rh.pagamentos.vt') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.folhas'))
END);

ALTER POLICY "hr transport batches update" ON public.hr_transport_batches
  USING (
CASE tipo
    WHEN 'salario'::text THEN public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE public.can_edit_pagina(auth.uid(), 'rh.pagamentos.vt')
END)
  WITH CHECK (
CASE tipo
    WHEN 'salario'::text THEN public.can_edit_pagina(auth.uid(), 'rh.pagamentos.salario')
    ELSE public.can_edit_pagina(auth.uid(), 'rh.pagamentos.vt')
END);

ALTER POLICY "fin delete initial_balances" ON public.initial_balances
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin insert initial_balances" ON public.initial_balances
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin update initial_balances" ON public.initial_balances
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin view initial_balances" ON public.initial_balances
  USING (public.can_view_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "edit delete leads" ON public.leads
  USING ((public.can_edit_pagina(auth.uid(), 'admissoes') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "edit insert leads" ON public.leads
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'admissoes') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "edit update leads" ON public.leads
  USING ((public.can_edit_pagina(auth.uid(), 'admissoes') AND can_access_school(auth.uid(), school_id)))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'admissoes') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "view leads" ON public.leads
  USING ((public.can_view_pagina(auth.uid(), 'admissoes') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "material_pedagogico_itens_select" ON public.material_pedagogico_itens
  USING ((public.can_view_pagina(auth.uid(), 'configuracoes.cadastros.valor_material') OR public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "material_pedagogico_series_select" ON public.material_pedagogico_series
  USING ((public.can_view_pagina(auth.uid(), 'configuracoes.cadastros.valor_material') OR public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "admissoes view matricula_documentos" ON public.matricula_documentos
  USING (public.can_view_pagina(auth.uid(), 'eformulario'));

ALTER POLICY "matricula_faturamento_lancamentos_select" ON public.matricula_faturamento_lancamentos
  USING (public.can_view_pagina(auth.uid(), 'eformulario'));

ALTER POLICY "admissoes view matricula_saude" ON public.matricula_saude
  USING (public.can_view_pagina(auth.uid(), 'eformulario'));

ALTER POLICY "edit delete onboarding" ON public.onboarding
  USING ((public.can_edit_pagina(auth.uid(), 'onboarding') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "edit insert onboarding" ON public.onboarding
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'onboarding') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "edit update onboarding" ON public.onboarding
  USING ((public.can_edit_pagina(auth.uid(), 'onboarding') AND can_access_school(auth.uid(), school_id)))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'onboarding') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "view onboarding" ON public.onboarding
  USING ((public.can_view_pagina(auth.uid(), 'onboarding') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "fin delete reconciliations" ON public.reconciliations
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin insert reconciliations" ON public.reconciliations
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin update reconciliations" ON public.reconciliations
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin view reconciliations" ON public.reconciliations
  USING (public.can_view_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin delete recurring_forecasts" ON public.recurring_forecasts
  USING ((public.can_edit_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "fin insert recurring_forecasts" ON public.recurring_forecasts
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "fin update recurring_forecasts" ON public.recurring_forecasts
  USING ((public.can_edit_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "fin view recurring_forecasts" ON public.recurring_forecasts
  USING ((public.can_view_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "fin delete recurring_series" ON public.recurring_series
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin insert recurring_series" ON public.recurring_series
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin update recurring_series" ON public.recurring_series
  USING (public.can_edit_pagina(auth.uid(), 'analises_ia'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "fin view recurring_series" ON public.recurring_series
  USING (public.can_view_pagina(auth.uid(), 'analises_ia'));

ALTER POLICY "rematricula_acessos_select" ON public.rematricula_acessos
  USING ((public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "rematricula_cadastro_auditoria_select" ON public.rematricula_cadastro_auditoria
  USING ((public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "rematricula_campanhas_select" ON public.rematricula_campanhas
  USING (public.can_view_pagina(auth.uid(), 'matricula.campanhas'));

ALTER POLICY "rematricula_config_select" ON public.rematricula_config
  USING (public.can_view_pagina(auth.uid(), 'matricula.campanhas'));

ALTER POLICY "rematricula_envios_select" ON public.rematricula_envios
  USING ((public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "rematricula_escolhas_select" ON public.rematricula_escolhas
  USING ((public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "rematricula_extras_divergencias_select" ON public.rematricula_extras_divergencias
  USING (((public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos')) OR (public.can_view_pagina(auth.uid(), 'diario.registro') OR public.can_view_pagina(auth.uid(), 'diario.extras'))));

ALTER POLICY "rematricula_extras_escolhas_select" ON public.rematricula_extras_escolhas
  USING ((public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "rematricula_matricula_escolhas_select" ON public.rematricula_matricula_escolhas
  USING ((public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "rematricula_matricula_valores_select" ON public.rematricula_matricula_valores
  USING ((public.can_view_pagina(auth.uid(), 'configuracoes.cadastros.valor_matricula') OR public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "rematricula_responsavel_financeiro_select" ON public.rematricula_responsavel_financeiro
  USING ((public.can_view_pagina(auth.uid(), 'matricula.alunos') OR public.can_view_pagina(auth.uid(), 'matricula.contratos') OR public.can_view_pagina(auth.uid(), 'matricula.campanhas')));

ALTER POLICY "ref delete revenue_categories" ON public.revenue_categories
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.receitas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref insert revenue_categories" ON public.revenue_categories
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.receitas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref update revenue_categories" ON public.revenue_categories
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.receitas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.receitas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref delete revenue_subcategories" ON public.revenue_subcategories
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.receitas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref insert revenue_subcategories" ON public.revenue_subcategories
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.receitas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref update revenue_subcategories" ON public.revenue_subcategories
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.receitas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.receitas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "rh experiencia lidas insert" ON public.rh_experiencia_notificacoes_lidas
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos') AND (lido_por = auth.uid())));

ALTER POLICY "rh experiencia lidas select" ON public.rh_experiencia_notificacoes_lidas
  USING ((public.can_view_pagina(auth.uid(), 'rh.pessoal.efetivos') OR public.can_view_pagina(auth.uid(), 'rh.pessoal.terceirizados') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.vt') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.folhas') OR public.can_view_pagina(auth.uid(), 'rh.contracheques') OR public.can_view_pagina(auth.uid(), 'rh.ponto') OR public.can_view_pagina(auth.uid(), 'rh.estatistica') OR public.can_view_pagina(auth.uid(), 'rh.aniversarios')));

ALTER POLICY "estoque_material delete" ON public.school_material_stock
  USING (public.can_edit_pagina(auth.uid(), 'estoque_material'));

ALTER POLICY "estoque_material insert" ON public.school_material_stock
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'estoque_material'));

ALTER POLICY "estoque_material update" ON public.school_material_stock
  USING (public.can_edit_pagina(auth.uid(), 'estoque_material'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'estoque_material'));

ALTER POLICY "estoque_material view" ON public.school_material_stock
  USING (public.can_view_pagina(auth.uid(), 'estoque_material'));

ALTER POLICY "admissoes view student_routine" ON public.student_routine
  USING (public.can_view_pagina(auth.uid(), 'eformulario'));

ALTER POLICY "ref delete sub_cost_centers" ON public.sub_cost_centers
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.despesas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref insert sub_cost_centers" ON public.sub_cost_centers
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.despesas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "ref update sub_cost_centers" ON public.sub_cost_centers
  USING ((public.can_edit_pagina(auth.uid(), 'configuracoes.despesas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'configuracoes.despesas') OR public.can_edit_pagina(auth.uid(), 'analises_ia')));

ALTER POLICY "terceirizados delete" ON public.terceirizados
  USING (public.can_edit_pagina(auth.uid(), 'rh.pessoal.terceirizados'));

ALTER POLICY "terceirizados insert" ON public.terceirizados
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'rh.pessoal.terceirizados'));

ALTER POLICY "terceirizados select" ON public.terceirizados
  USING ((public.can_view_pagina(auth.uid(), 'rh.pessoal.efetivos') OR public.can_view_pagina(auth.uid(), 'rh.pessoal.terceirizados') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.vt') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.folhas') OR public.can_view_pagina(auth.uid(), 'rh.contracheques') OR public.can_view_pagina(auth.uid(), 'rh.ponto') OR public.can_view_pagina(auth.uid(), 'rh.estatistica') OR public.can_view_pagina(auth.uid(), 'rh.aniversarios')));

ALTER POLICY "terceirizados update" ON public.terceirizados
  USING (public.can_edit_pagina(auth.uid(), 'rh.pessoal.terceirizados'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'rh.pessoal.terceirizados'));

ALTER POLICY "fin delete transactions" ON public.transactions
  USING ((public.can_edit_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "fin insert transactions" ON public.transactions
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "fin update transactions" ON public.transactions
  USING ((public.can_edit_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)))
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "fin view transactions" ON public.transactions
  USING ((public.can_view_pagina(auth.uid(), 'analises_ia') AND can_access_school(auth.uid(), school_id)));

ALTER POLICY "unidade_valores_opcionais_select" ON public.unidade_valores_opcionais
  USING (public.can_view_pagina(auth.uid(), 'eformulario'));

ALTER POLICY "uniformes delete uniform_order_marks" ON public.uniform_order_marks
  USING (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes insert uniform_order_marks" ON public.uniform_order_marks
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes update uniform_order_marks" ON public.uniform_order_marks
  USING (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes view uniform_order_marks" ON public.uniform_order_marks
  USING ((public.can_view_pagina(auth.uid(), 'uniformes.estoque') OR public.can_view_pagina(auth.uid(), 'uniformes.vendas')));

ALTER POLICY "uniformes delete uniform_products" ON public.uniform_products
  USING (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes insert uniform_products" ON public.uniform_products
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes update uniform_products" ON public.uniform_products
  USING (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes view uniform_products" ON public.uniform_products
  USING ((public.can_view_pagina(auth.uid(), 'uniformes.estoque') OR public.can_view_pagina(auth.uid(), 'uniformes.vendas')));

ALTER POLICY "uniformes delete uniform_sync_log" ON public.uniform_sync_log
  USING (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes insert uniform_sync_log" ON public.uniform_sync_log
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes update uniform_sync_log" ON public.uniform_sync_log
  USING (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes view uniform_sync_log" ON public.uniform_sync_log
  USING ((public.can_view_pagina(auth.uid(), 'uniformes.estoque') OR public.can_view_pagina(auth.uid(), 'uniformes.vendas')));

ALTER POLICY "uniformes delete uniform_variants" ON public.uniform_variants
  USING (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes insert uniform_variants" ON public.uniform_variants
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes update uniform_variants" ON public.uniform_variants
  USING (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'uniformes.estoque'));

ALTER POLICY "uniformes view uniform_variants" ON public.uniform_variants
  USING ((public.can_view_pagina(auth.uid(), 'uniformes.estoque') OR public.can_view_pagina(auth.uid(), 'uniformes.vendas')));

ALTER POLICY "cobranca delete whatsapp_billing_exceptions" ON public.whatsapp_billing_exceptions
  USING (public.can_edit_pagina(auth.uid(), 'mensagens.cobrancas'));

ALTER POLICY "cobranca insert whatsapp_billing_exceptions" ON public.whatsapp_billing_exceptions
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'mensagens.cobrancas'));

ALTER POLICY "cobranca update whatsapp_billing_exceptions" ON public.whatsapp_billing_exceptions
  USING (public.can_edit_pagina(auth.uid(), 'mensagens.cobrancas'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'mensagens.cobrancas'));

ALTER POLICY "cobranca view whatsapp_billing_exceptions" ON public.whatsapp_billing_exceptions
  USING (public.can_view_pagina(auth.uid(), 'mensagens.cobrancas'));

ALTER POLICY "cobranca delete whatsapp_billing_logs" ON public.whatsapp_billing_logs
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "cobranca insert whatsapp_billing_logs" ON public.whatsapp_billing_logs
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "cobranca update whatsapp_billing_logs" ON public.whatsapp_billing_logs
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "cobranca view whatsapp_billing_logs" ON public.whatsapp_billing_logs
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "cobranca update whatsapp_billing_pause" ON public.whatsapp_billing_pause
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "cobranca view whatsapp_billing_pause" ON public.whatsapp_billing_pause
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "delete whatsapp_billing_pauses" ON public.whatsapp_billing_pauses
  USING ((public.can_edit_pagina(auth.uid(), 'atendimento') OR (public.can_edit_pagina(auth.uid(), 'mensagens.cobrancas') OR public.can_edit_pagina(auth.uid(), 'mensagens.lembretes'))));

ALTER POLICY "insert whatsapp_billing_pauses" ON public.whatsapp_billing_pauses
  WITH CHECK ((public.can_edit_pagina(auth.uid(), 'atendimento') OR (public.can_edit_pagina(auth.uid(), 'mensagens.cobrancas') OR public.can_edit_pagina(auth.uid(), 'mensagens.lembretes'))));

ALTER POLICY "view whatsapp_billing_pauses" ON public.whatsapp_billing_pauses
  USING ((public.can_view_pagina(auth.uid(), 'atendimento') OR (public.can_view_pagina(auth.uid(), 'mensagens.cobrancas') OR public.can_view_pagina(auth.uid(), 'mensagens.lembretes'))));

ALTER POLICY "atendimento delete whatsapp_conversations" ON public.whatsapp_conversations
  USING (public.can_edit_pagina(auth.uid(), 'atendimento'));

ALTER POLICY "atendimento insert whatsapp_conversations" ON public.whatsapp_conversations
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'atendimento'));

ALTER POLICY "atendimento update whatsapp_conversations" ON public.whatsapp_conversations
  USING (public.can_edit_pagina(auth.uid(), 'atendimento'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'atendimento'));

ALTER POLICY "atendimento view whatsapp_conversations" ON public.whatsapp_conversations
  USING (public.can_view_pagina(auth.uid(), 'atendimento'));

ALTER POLICY "cobranca view whatsapp_cron_runs" ON public.whatsapp_cron_runs
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "insert whatsapp_falhas_arquivadas" ON public.whatsapp_falhas_arquivadas
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'mensagens.falhas'));

ALTER POLICY "view whatsapp_falhas_arquivadas" ON public.whatsapp_falhas_arquivadas
  USING (public.can_view_pagina(auth.uid(), 'mensagens.falhas'));

ALTER POLICY "delete whatsapp_lembrete_pausas" ON public.whatsapp_lembrete_pausas
  USING (public.can_edit_pagina(auth.uid(), 'mensagens.lembretes'));

ALTER POLICY "insert whatsapp_lembrete_pausas" ON public.whatsapp_lembrete_pausas
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'mensagens.lembretes'));

ALTER POLICY "view whatsapp_lembrete_pausas" ON public.whatsapp_lembrete_pausas
  USING (public.can_view_pagina(auth.uid(), 'mensagens.lembretes'));

ALTER POLICY "atendimento delete whatsapp_messages" ON public.whatsapp_messages
  USING (public.can_edit_pagina(auth.uid(), 'atendimento'));

ALTER POLICY "atendimento insert whatsapp_messages" ON public.whatsapp_messages
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'atendimento'));

ALTER POLICY "atendimento update whatsapp_messages" ON public.whatsapp_messages
  USING (public.can_edit_pagina(auth.uid(), 'atendimento'))
  WITH CHECK (public.can_edit_pagina(auth.uid(), 'atendimento'));

ALTER POLICY "atendimento view whatsapp_messages" ON public.whatsapp_messages
  USING (public.can_view_pagina(auth.uid(), 'atendimento'));

ALTER POLICY "zapsign_documentos read" ON public.zapsign_documentos
  USING ((public.can_view_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_view_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_view_pagina(auth.uid(), 'documentos.historico') OR public.can_view_pagina(auth.uid(), 'documentos.zapsign')));

ALTER POLICY "zapsign_documentos read rematricula" ON public.zapsign_documentos
  USING (((ambiente = 'producao'::text) AND public.can_view_pagina(auth.uid(), 'matricula.contratos')));

ALTER POLICY "zapsign_eventos read" ON public.zapsign_eventos
  USING ((public.can_view_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_view_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_view_pagina(auth.uid(), 'documentos.historico') OR public.can_view_pagina(auth.uid(), 'documentos.zapsign')));

ALTER POLICY "zapsign_webhooks read" ON public.zapsign_webhooks
  USING ((public.can_view_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_view_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_view_pagina(auth.uid(), 'documentos.historico') OR public.can_view_pagina(auth.uid(), 'documentos.zapsign')));

ALTER POLICY "diario fotos delete" ON storage.objects
  USING (((bucket_id = 'diario-fotos'::text) AND public.can_edit_pagina(auth.uid(), 'diario.registro')));

ALTER POLICY "diario fotos insert" ON storage.objects
  WITH CHECK (((bucket_id = 'diario-fotos'::text) AND public.can_edit_pagina(auth.uid(), 'diario.registro')));

ALTER POLICY "diario fotos update" ON storage.objects
  USING (((bucket_id = 'diario-fotos'::text) AND public.can_edit_pagina(auth.uid(), 'diario.registro')))
  WITH CHECK (((bucket_id = 'diario-fotos'::text) AND public.can_edit_pagina(auth.uid(), 'diario.registro')));

ALTER POLICY "documentos storage delete" ON storage.objects
  USING (((bucket_id = 'documentos'::text) AND (public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_edit_pagina(auth.uid(), 'documentos.historico') OR public.can_edit_pagina(auth.uid(), 'documentos.zapsign'))));

ALTER POLICY "documentos storage insert" ON storage.objects
  WITH CHECK (((bucket_id = 'documentos'::text) AND (public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_edit_pagina(auth.uid(), 'documentos.historico') OR public.can_edit_pagina(auth.uid(), 'documentos.zapsign'))));

ALTER POLICY "documentos storage read" ON storage.objects
  USING (((bucket_id = 'documentos'::text) AND (public.can_view_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_view_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_view_pagina(auth.uid(), 'documentos.historico') OR public.can_view_pagina(auth.uid(), 'documentos.zapsign'))));

ALTER POLICY "documentos storage update" ON storage.objects
  USING (((bucket_id = 'documentos'::text) AND (public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_edit_pagina(auth.uid(), 'documentos.historico') OR public.can_edit_pagina(auth.uid(), 'documentos.zapsign'))))
  WITH CHECK (((bucket_id = 'documentos'::text) AND (public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual') OR public.can_edit_pagina(auth.uid(), 'documentos.gerar.lote') OR public.can_edit_pagina(auth.uid(), 'documentos.historico') OR public.can_edit_pagina(auth.uid(), 'documentos.zapsign'))));

ALTER POLICY "hr documents delete" ON storage.objects
  USING (((bucket_id = 'hr-documents'::text) AND public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos')));

ALTER POLICY "hr documents insert" ON storage.objects
  WITH CHECK (((bucket_id = 'hr-documents'::text) AND public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos')));

ALTER POLICY "hr documents read" ON storage.objects
  USING (((bucket_id = 'hr-documents'::text) AND (public.can_view_pagina(auth.uid(), 'rh.pessoal.efetivos') OR public.can_view_pagina(auth.uid(), 'rh.pessoal.terceirizados') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.vt') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.folhas') OR public.can_view_pagina(auth.uid(), 'rh.contracheques') OR public.can_view_pagina(auth.uid(), 'rh.ponto') OR public.can_view_pagina(auth.uid(), 'rh.estatistica') OR public.can_view_pagina(auth.uid(), 'rh.aniversarios'))));

ALTER POLICY "hr documents update" ON storage.objects
  USING (((bucket_id = 'hr-documents'::text) AND public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos')))
  WITH CHECK (((bucket_id = 'hr-documents'::text) AND public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos')));

ALTER POLICY "matricula documentos read" ON storage.objects
  USING (((bucket_id = 'matricula-documentos'::text) AND public.can_view_pagina(auth.uid(), 'eformulario')));

ALTER POLICY "rh atestados delete" ON storage.objects
  USING (((bucket_id = 'rh-atestados'::text) AND public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos')));

ALTER POLICY "rh atestados insert" ON storage.objects
  WITH CHECK (((bucket_id = 'rh-atestados'::text) AND public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos')));

ALTER POLICY "rh atestados read" ON storage.objects
  USING (((bucket_id = 'rh-atestados'::text) AND (public.can_view_pagina(auth.uid(), 'rh.pessoal.efetivos') OR public.can_view_pagina(auth.uid(), 'rh.pessoal.terceirizados') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.vt') OR public.can_view_pagina(auth.uid(), 'rh.pagamentos.folhas') OR public.can_view_pagina(auth.uid(), 'rh.contracheques') OR public.can_view_pagina(auth.uid(), 'rh.ponto') OR public.can_view_pagina(auth.uid(), 'rh.estatistica') OR public.can_view_pagina(auth.uid(), 'rh.aniversarios'))));

ALTER POLICY "rh atestados update" ON storage.objects
  USING (((bucket_id = 'rh-atestados'::text) AND public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos')))
  WITH CHECK (((bucket_id = 'rh-atestados'::text) AND public.can_edit_pagina(auth.uid(), 'rh.pessoal.efetivos')));

ALTER POLICY "whatsapp media insert saida" ON storage.objects
  WITH CHECK (((bucket_id = 'whatsapp-media'::text) AND (name ~~ 'saida/%'::text) AND public.can_edit_pagina(auth.uid(), 'atendimento')));

ALTER POLICY "whatsapp media read" ON storage.objects
  USING (((bucket_id = 'whatsapp-media'::text) AND public.can_view_pagina(auth.uid(), 'atendimento')));

-- hr_timesheet_days (20260915090000) ainda não existe em produção; a policy
-- é recriada só se a tabela existir, para a migration valer nos dois cenários.
DO $$
BEGIN
  IF to_regclass('public.hr_timesheet_days') IS NOT NULL THEN
    EXECUTE $p$ALTER POLICY "hr timesheet days select" ON public.hr_timesheet_days
      USING ((public.can_view_pagina(auth.uid(), 'rh.ponto') OR public.can_view_pagina(auth.uid(), 'rh.estatistica')))$p$;
  END IF;
END $$;

-- ---------- (d) funções auxiliares que checavam módulo ----------
-- Pedagógico: 'pedagogico' -> módulo Secretaria (qualquer página, por prefixo)
-- para leitura; gravação por página responsável (sobrecarga com _pagina).
-- Esportes: chave canônica 'esportes' (mesmo nome do legado); a restrição por
-- modalidade (esportes_modalidade_acessos) continua igual.

CREATE OR REPLACE FUNCTION public.pedagogico_pode_ver(_user_id uuid, _school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.can_view_pagina(_user_id, 'secretaria')
     AND public.can_access_school(_user_id, _school_id);
$$;

CREATE OR REPLACE FUNCTION public.pedagogico_pode_editar(_user_id uuid, _school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.can_edit_pagina(_user_id, 'secretaria')
     AND public.can_access_school(_user_id, _school_id);
$$;

CREATE OR REPLACE FUNCTION public.pedagogico_pode_editar(_user_id uuid, _school_id uuid, _pagina text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.can_edit_pagina(_user_id, _pagina)
     AND public.can_access_school(_user_id, _school_id);
$$;

REVOKE ALL ON FUNCTION public.pedagogico_pode_editar(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pedagogico_pode_editar(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.pedagogico_pode_editar(uuid, uuid, text) TO authenticated, service_role;

ALTER POLICY "pedagogico edit disciplinas" ON public.disciplinas
  USING (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.disciplinas'))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.disciplinas'));

ALTER POLICY "pedagogico edit pedagogico_atribuicoes" ON public.pedagogico_atribuicoes
  USING (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.atribuicoes'))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.atribuicoes'));

ALTER POLICY "pedagogico edit pedagogico_calendario" ON public.pedagogico_calendario
  USING (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.calendario'))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.calendario'));

ALTER POLICY "pedagogico edit horarios" ON public.pedagogico_horarios
  USING (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.horarios'))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.horarios'));

ALTER POLICY "pedagogico edit pedagogico_atividades_avaliativas" ON public.pedagogico_atividades_avaliativas
  USING (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.notas'))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.notas'));

ALTER POLICY "pedagogico edit pedagogico_recuperacoes_trimestre" ON public.pedagogico_recuperacoes_trimestre
  USING (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.notas'))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.notas'));

ALTER POLICY "pedagogico edit pedagogico_recuperacoes_finais" ON public.pedagogico_recuperacoes_finais
  USING (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.notas'))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.notas'));

ALTER POLICY "pedagogico edit pedagogico_pareceres" ON public.pedagogico_pareceres
  USING (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.notas'))
  WITH CHECK (public.pedagogico_pode_editar(auth.uid(), school_id, 'secretaria.notas'));

CREATE OR REPLACE FUNCTION public.can_view_modalidade_esporte(_user_id uuid, _modalidade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.can_view_pagina(_user_id, 'esportes')
    AND (
      NOT public.esportes_restrito_por_modalidade(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.esportes_modalidade_acessos
        WHERE user_id = _user_id AND modalidade_id = _modalidade_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.pode_editar_esportes(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.can_edit_pagina(_user_id, 'esportes')
    AND NOT public.esportes_restrito_por_modalidade(_user_id);
$$;

-- ---------- (e) remoção das funções antigas ----------
-- Falha (e desfaz tudo) se ainda houver policy/função dependente.

DROP FUNCTION public.can_view_module(uuid, public.app_module);
DROP FUNCTION public.can_edit_module(uuid, public.app_module);

-- ---------- (f) auditoria: zero referência a can_*_module / chaves antigas ----------
DO $$
DECLARE
  n_pol int;
  n_fn int;
BEGIN
  SELECT count(*) INTO n_pol
  FROM pg_policies
  WHERE coalesce(qual, '') || coalesce(with_check, '') ~ 'can_(view|edit)_module';
  SELECT count(*) INTO n_fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname IN ('can_view_module', 'can_edit_module')
         OR p.prosrc ~ 'can_(view|edit)_module');
  IF n_pol <> 0 OR n_fn <> 0 THEN
    RAISE EXCEPTION 'permissoes_arvore: ainda há % policies e % funções com can_*_module', n_pol, n_fn;
  END IF;
END $$;

COMMIT;
