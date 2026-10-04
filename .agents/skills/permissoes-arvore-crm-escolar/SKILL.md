---
name: permissoes-arvore-crm-escolar
description: Regra permanente do Sérgio para o crm-escolar (School Hub) — existe UMA árvore de permissões Grupo > Módulo > Página (aba/sub-aba) em src/lib/permissoes-arvore.ts, que alimenta ao mesmo tempo o menu lateral, as abas de cada página, a tela Gerenciar Acessos e as checagens do servidor/RLS. Ler antes de criar, renomear ou remover qualquer rota, módulo, página, aba, TabsTrigger, canView/canEdit, server function protegida, RPC ou policy.
---

# Árvore única de permissões (regra permanente)

## A regra

`src/lib/permissoes-arvore.ts` é a ÚNICA fonte da verdade para módulos, páginas e
abas do sistema. Todo módulo, página ou aba **criado, renomeado ou removido** deve
ser cadastrado/atualizado nessa árvore **no mesmo PR**, junto com:

1. a checagem de servidor correspondente (`exigirPermissaoPagina` /
   `temPermissaoPagina` em `src/lib/permissoes-servidor.ts`, ou `can_view_pagina` /
   `can_edit_pagina` em RLS/RPC) usando a chave da PÁGINA a que o dado pertence;
2. a migration de permissão quando a chave for nova (valor no enum
   `public.app_module` via `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, e cópia de
   Visualizar/Editar a partir da chave antiga quando houver correspondência).

O teste `src/lib/permissoes-arvore.test.ts` roda com `bun run test` / CI e FALHA quando:

- (a) há rota em `src/routes` (fora das públicas `/matricula`, `/portal*`,
  `/rematricula*`, `*/verificar`) sem módulo na árvore;
- (b) há `<TabsTrigger>` fora de `src/components/AbasArvore.tsx` (exceções só para
  abas internas de diálogo, listadas em `ABAS_INTERNAS_DE_DIALOGO` no teste);
- (c) alguma chave usada em `canView`/`canEdit`, em `temPermissaoPagina` /
  `exigirPermissaoPagina` ou em `can_view_pagina`/`can_edit_pagina` nas migrations
  não existe na árvore;
- (d) há chave duplicada, chave de página que não começa pela chave do pai, ou
  folha gravável sem valor no enum.

Não afrouxe o teste para passar: cadastre o nó.

## Estrutura da árvore

```ts
{ chave: "grupo_comercial", nome: "Comercial", tipo: "grupo", filhos: [
  { chave: "matricula", nome: "Matrícula", tipo: "modulo", rota: "/matriculas", filhos: [
    { chave: "matricula.alunos",    nome: "Alunos",    tipo: "pagina", legado: um("rematricula") },
    { chave: "matricula.contratos", nome: "Contratos", tipo: "pagina", legado: um("rematricula") },
    ...
```

- **chave**: texto estável, minúsculas, `pai.filho`; NUNCA muda quando o nome muda.
- **nome**: exatamente o que aparece no menu/aba (renomear aqui renomeia em tudo).
- **tipo**: `grupo` | `modulo` | `pagina`. Grupos não geram permissão; módulos e
  páginas são `ChavePermissao`.
- **rota**: só em módulos; deve existir em `src/routes`.
- **legado**: expressão sobre as chaves antigas (`CHAVES_LEGADAS`) usada pela
  migration de cópia e pelo dry-run. Nó novo sem correspondente antigo não tem `legado`.
- **acessoEspecial**: `"admin"` (interruptor Administrador) ou `"professor"`
  (vínculo `funcionarios.auth_user_id`) — nó que não entra em `user_permissions`.

O id de uma aba é o último segmento da chave (`matricula.contratos` → `contratos`);
`TabsContent value` deve usar exatamente esse id.

## Como consumir

- **Menu** (`src/routes/__root.tsx`): lê `ARVORE_PERMISSOES`; módulo aparece se o
  usuário tem Visualizar em pelo menos uma página dele.
- **Abas**: `<AbasArvore chavePai="modulo" />` (+ `useAbasArvore` / `useAbaAtiva`);
  nunca escreva `<TabsList><TabsTrigger>` à mão numa página. Ícones/badges vão em
  `antes` / `depois`; abas fora de contexto em `ocultar`.
- **Cliente**: `canView("modulo.pagina")` / `canEdit("modulo.pagina")`; Editar
  implica Visualizar; pai = OR dos filhos.
- **Servidor**: leitura exige Visualizar; gravação exige Editar da página
  responsável. Função que atende várias páginas: OR das chaves para leitura, chave
  específica para gravação — e o caso listado na descrição do PR.
- **Acesso negado**: `<AccessDenied />`, nunca `ErrorComponent`.
- **Editor**: `src/components/configuracoes/ArvorePermissoes.tsx` deriva as linhas
  da árvore — nada a fazer ao adicionar nós.

## Exceções à regra "gravar exige Editar" (decididas pelo Sérgio)

- **Anexar documento na ficha da matrícula** (`DocumentosFicha.tsx`,
  `urlUploadDocumentoSecretaria` / `registrarDocumentoSecretaria` em
  `src/lib/matriculas.functions.ts`): basta **Visualizar** no `eformulario` para
  "Anexar" um documento pendente da lista e para "Anexar outro documento" (nome
  livre). **Substituir** um documento que já tem arquivo continua exigindo Editar
  (o servidor recusa e remove o arquivo recém-enviado do bucket); **Excluir**
  continua só admin. A exceção vale só para anexar: nenhuma outra ação da tela
  Matrículas é liberada com Visualizar. Travado em `permissoes-arvore.test.ts`.

## Regras especiais que continuam fora da árvore

- Esportes por modalidade (`can_view_modalidade_esporte`), escopo escolar do
  Pedagógico (`can_access_school`) e lançamento do professor na própria atribuição.
- Colégios que cada usuário enxerga (`allowedSponteUnidades`) — ver a skill
  `seletor-global-unidade-crm-escolar`.

## Migration

Toda migration de permissão é aditiva: adiciona valores ao enum e copia
Visualizar/Editar; nunca apaga linhas antigas no mesmo PR. Fica NÃO aplicada até
autorização do Sérgio, aplicada ANTES do merge (skill `migrations-deploy-crm-escolar`),
com dry-run (`npx tsx scripts/permissoes-arvore/dry-run.ts <dados.json>`) confirmando
"Rotas idênticas por usuário: SIM".
