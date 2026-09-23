---
name: seletor-global-unidade-crm-escolar
description: Regra permanente do Sérgio para o crm-escolar (School Hub) — toda tela mostra SOMENTE o que o seletor global de unidade do topo (useSchool / useUnidadeAtiva) seleciona; nenhuma tela tem escolha interna de unidade. Ler antes de criar ou alterar qualquer tela, aba, filtro, link interno ou server function que envolva unidade/colégio.
---

# Seletor global de unidade (regra permanente)

## A regra

Toda tela mostra SOMENTE o que o seletor global do topo (`useSchool` em
`src/lib/app-context.tsx` / `useUnidadeAtiva` em `src/components/SelecioneUnidade.tsx`)
estiver selecionando. Nenhuma tela pode ter escolha interna de unidade:

- abas por unidade (`TabsTrigger` iterando `UNIDADES_SPONTE`, `schools`, etc.);
- select de unidade como filtro da tela;
- unidade vinda da URL (`?unidade=`, `search.unidade`);
- unidade padrão fixa (`UNIDADES[0]`, `"CEC"` como default);
- exceção para "item de outra unidade" (mostrar algo que não é da unidade do topo).

Comportamento esperado:

- **Topo em uma unidade**: só dados dessa unidade. Ações de escrita gravam nessa unidade.
- **Topo em "Todas as Unidades"**: consolidado das unidades permitidas ao usuário
  (`allowedSponteUnidades` no servidor), identificando a unidade em cada item
  (badge/coluna). Ações de escrita que exigem uma unidade ficam bloqueadas com
  `<SelecioneUnidade acao="..." />` — nunca com um segundo seletor na tela.
- **Links internos** (sino, atalhos, "abrir caso", deep links) para item de outra
  unidade TROCAM o seletor global (`setSelected(school.id)`) antes/ao navegar, como
  fazem o aviso de fechamento da inadimplência e os avisos de prazo da Cobrança em
  `src/components/NotificationsBell.tsx`. Se a tela abre um item pela URL (ex.:
  `/cobranca?caso=...`), ela mesma sincroniza o topo com a unidade do item ao carregar
  (ver `CasoView` em `src/routes/cobranca.tsx`).
- **Server functions**: aceitam `unidade: string | null`; `null` = consolidado restrito
  às unidades permitidas do usuário (`exigirUnidade` para uma unidade, `.in("unidade",
permitidas)` para o consolidado). RBAC nunca é afrouxado para o consolidado.

Helpers: `src/lib/unidade-global.ts` (`unidadeAtiva`, `escolaAtivaId`,
`exigeUnidadeEspecifica`, `filtrarPorUnidade`, `MENSAGEM_UNIDADE_ESPECIFICA`).

## Exceções permitidas (documentadas)

1. O próprio seletor do topo (`src/components/SchoolFilter.tsx`).
2. Telas de cadastro de dados da unidade que já seguem o topo (ex.: Dados dos Colégios,
   Testemunhas, Tabela de Preços): editam a unidade selecionada no topo.
3. Telas públicas sem login (não existe seletor do topo): `/matricula`,
   `/rematricula*`, `/portal`, `/portal-cantina`, `/professor`.
4. Campo "Unidade" como **atributo de um registro** em formulário de criação
   (funcionário, terceirizado, lead, permissões por unidade em Configurações): não é
   filtro da tela. O padrão do campo deve ser a unidade do topo.
   Qualquer caso além destes é **dúvida**: listar no PR e NÃO alterar sem o Sérgio.

**Atributo de unidade de um registro novo também vem do topo, sem campo de escolha**
(decisão do Sérgio na Agenda, PR D): a reunião é sempre criada na unidade selecionada
no topo; com "Todas as Unidades" a ação fica bloqueada com
`<SelecioneUnidade acao="Agendar uma reunião" />`; na edição a unidade é exibida só
como texto (não alterável) e abrir a edição de um registro de outra unidade troca o
seletor global (`setSelected`) para a unidade do registro. Formulários novos devem
seguir este padrão; os da exceção 4 são legado a alinhar quando o Sérgio decidir.

## Trava automática

`src/lib/unidade-global.estrutura.test.ts` varre:

- a lista `TELAS` (telas corrigidas) e **todos** os componentes de
  `src/components/cobranca`;
- **todos** os arquivos de `src/routes`, exceto a lista explícita `EXCECOES_ROTAS`
  (com o motivo em comentário).

Falha quando encontra estado próprio de unidade, unidade padrão fixa, "Todas as
unidades" interno, `TabsTrigger`/`SelectItem` dentro de `.map` sobre lista de
unidades/colégios, ou leitura de `unidade` de parâmetro de URL.

**Toda tela nova nasce coberta**: rotas novas em `src/routes` entram automaticamente;
componentes novos que tratam unidade devem ser adicionados a `TELAS`. Só adicione um
arquivo a `EXCECOES_ROTAS` se ele se enquadrar nas exceções acima, com o motivo.

## Pedidos do tipo "uma aba por unidade"

Pedido de "uma aba por unidade", "select de unidade na tela", "filtro de colégio" ou
equivalente deve ser interpretado como **filtro pelo seletor global do topo**
(uma unidade = só ela; "Todas" = consolidado com a unidade em cada item). Implementar
assim e **avisar o Sérgio no PR** que o pedido foi atendido pelo seletor global, sem
criar escolha interna de unidade.
