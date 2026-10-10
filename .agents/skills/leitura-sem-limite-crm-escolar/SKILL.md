---
name: leitura-sem-limite-crm-escolar
description: Regra permanente do Sérgio para o crm-escolar (School Hub) — o Supabase/PostgREST devolve no máximo 1.000 linhas por consulta e corta o resto SEM erro. Toda leitura de lista usa fetchAllRows/selectAll/selectAllResult ou agrega no banco; limite só com comentário de motivo; nunca confiar no limite padrão. Ler antes de escrever ou alterar qualquer `.from(...).select(...)` ou `.rpc(...)` que devolva lista.
---

# Leitura sem limite (teto de 1.000 linhas do PostgREST)

## O problema

O PostgREST do Supabase devolve no máximo 1.000 linhas por resposta (`max_rows`) e
corta o resto **sem erro**: a tela ou o cálculo usa só as primeiras 1.000 e o
resultado fica errado em silêncio. Já aconteceu no Extrato Bancário e na
Inadimplência. Vale para o cliente do navegador (`supabase`), para o
`supabaseAdmin` e para RPCs que devolvem conjunto.

## A regra

Toda leitura de lista usa uma destas formas:

1. **Paginação completa** com os helpers de `src/lib/supabase-paginate.ts`:
   - `selectAll<T>(() => consulta)` devolve `T[]` e lança o erro;
   - `selectAllResult<T>(() => consulta)` devolve `{ data, error }` como uma consulta
     comum (use para trocar uma leitura existente sem mexer no tratamento de erro);
   - `fetchAllRows<T>((from, to) => consulta.range(from, to))` na forma longa.

   A consulta precisa de **ordem estável**: a coluna de negócio seguida de
   `.order("id", { ascending: true })` (ou só `id`). Sem isso as páginas podem
   repetir ou pular linhas. Com filtro condicional, monte a consulta dentro da
   fábrica (`() => { let q = ...; if (x) q = q.eq(...); return q; }`).
2. **Agregação no banco** para total, soma ou contagem: `{ count: "exact", head: true }`,
   `update(..., { count: "exact" })` ou uma RPC/view que já devolve o número.
   Não baixar linhas só para contar ou somar no JavaScript.
3. **Registro único**: `.single()` ou `.maybeSingle()`.
4. **`.range()` explícito** (paginação de tela).
5. **`.limit(N)` intencional** com o comentário `// limite-intencional: <motivo>`
   logo acima da consulta (ou na linha do `.limit`). Exemplos: "últimas 30
   notificações", "só verifica se existe".
6. **Leitura restrita** sem paginação, com `// leitura-restrita: <motivo>` logo acima
   da consulta. Vale **só** para:
   - leitura filtrada por um único registro, aluno, caso, lote ou submissão
     (`eq("caso_id")`, `eq("submission_id")`, `eq("aluno_id")`, `eq("user_id")`);
   - tabela de configuração pequena e de tamanho fixo (`schools`,
     `revenue_categories`, `cost_centers`, tabelas de valores por colégio).

   O motivo é curto e concreto ("filtrada por caso_id", "configuração: tabela de
   colégios"). Tabela que cresce sem filtro por um único registro (tarefas,
   notificações, lançamentos, funcionários, produtos etc.) **não** leva o marcador:
   pagina.

Nunca confiar no limite padrão, nunca usar `.limit(1000)` ou um número grande como
"paginação" e nunca contar com a mudança do `max_rows` no painel.

## RPCs

RPC que devolve conjunto também é cortada em 1.000. Prefira que a função já
agregue no banco; se precisar da lista, pagine com `.range()` via `fetchAllRows`
(com ordem estável dentro da função).

## Trava automática

`src/lib/leitura-sem-limite.test.ts` roda na suíte (e no CI) e falha quando encontra
em `src/lib`, `src/routes` ou `src/components` um `.from(...).select(...)` sem uma das
formas acima. A mensagem lista arquivo, linha e trecho. Para conferir:

```bash
npx vitest run src/lib/leitura-sem-limite.test.ts
```

Não silencie a trava colocando o marcador em leitura que cresce: corrija a leitura.

## Alarme em produção

`src/lib/supabase-alarme-teto.ts` embrulha o `fetch` dos dois clientes
(`src/integrations/supabase/client.ts` e `client.server.ts`). Quando uma leitura
**sem** paginação explícita (sem `limit`/`offset` na URL e sem cabeçalho `Range`)
volta com exatamente 1.000 linhas no `Content-Range`, registra `console.warn` com
a tabela/RPC, a URL sem query e a chamada de origem. Ele só lê o cabeçalho (nunca o
corpo), não muda a resposta e engole qualquer erro. As leituras de
`selectAll`/`fetchAllRows` não disparam o alarme. Se os clientes forem regenerados,
recoloque o `global: { fetch: fetchComAlarmeDeTeto() }` (há um comentário no topo
dos dois arquivos).

## Testes

Todo total, soma ou contagem corrigido ganha teste com mais de 1.000 linhas
simuladas (ex.: 2.500), com um fake que corta em 1.000 quando não há `.range`.
Ver `src/lib/supabase-leituras.test.ts` e `src/lib/supabase-paginate.test.ts`.
