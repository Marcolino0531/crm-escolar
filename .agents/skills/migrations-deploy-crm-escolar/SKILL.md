---
name: migrations-deploy-crm-escolar
description: Regra permanente do Sérgio para PRs do crm-escolar (School Hub) que contêm migration Supabase — nunca mergear sozinho; merge e aplicação em produção acontecem juntos, só após autorização explícita (merge feito pelo próprio Sérgio vale como autorização: aplicar na mesma janela). Ler antes de abrir, mergear ou aplicar qualquer migration em supabase/migrations.
---

# Migrations: merge e aplicação em produção sempre juntos

Regra permanente definida pelo Sérgio (dono do repositório). Vale para TODOS os PRs.

## PR COM migration (`supabase/migrations/*.sql`)

1. Abrir o PR com a migration **NÃO aplicada** em produção. Deixar isso explícito
   no título/descrição do PR e na mensagem ao usuário ("migration NÃO aplicada").
2. **Aguardar a autorização explícita do Sérgio.** Não mergear, não aplicar.
3. Com a autorização, fazer o **merge e aplicar a migration em produção JUNTOS,
   na mesma janela**. Em seguida confirmar:
   - o deploy de produção da Vercel (`schoolhubbr.vercel.app`) corresponde ao
     último commit de `base` (`vercel inspect <url>` / `vercel ls crm-escolar --prod`,
     comparar com `git log -1 origin/base`);
   - a tela afetada carrega sem erro (navegar em produção, só leitura).
4. Responder ao Sérgio com o resultado de cada passo (contagens, policies,
   RLS/privilégios, buckets, deploy, tela).

PRs dependentes (um usa tabelas do outro): aplicar as migrations **na ordem de
dependência, sempre junto com o merge de cada PR**.

### Merge feito pelo próprio Sérgio

Se o **próprio Sérgio** (`Marcolino0531`) fizer o merge de um PR que contém
migration, **o merge dele vale como autorização**. Nesse caso:

1. Aplicar a migration **imediatamente, na mesma janela do deploy** (não esperar
   nova mensagem — o código em `base` já depende da coluna/tabela).
2. Fazer as verificações de sempre: estrutura (colunas, RLS, privilégios,
   buckets), contagens e tela afetada carregando sem erro em produção.
3. Reportar em seguida ao Sérgio, dizendo que a migration foi aplicada por
   conta do merge dele.

Conferir quem fez o merge (`git_view_pr` / autor do commit de merge). Nos demais
casos — merge por qualquer outra pessoa ou PR ainda aberto — a regra continua a
mesma: **não mergear nem aplicar migration sem autorização escrita do Sérgio.**

**Nunca deixar código em produção que dependa de tabela, coluna, policy, função
ou bucket ainda não criados.**

## PR SEM migration

Fluxo normal: merge após aprovação do Sérgio e CI verde.

## Como aplicar a migration em produção

Projeto Supabase `cblgybuplychbmgyxawl`. Usar a Management API com o token em
`$SUPABASE_ACCESS_TOKEN` (segredo do ambiente; nunca imprimir):

```
POST https://api.supabase.com/v1/projects/cblgybuplychbmgyxawl/database/query
{"query": "<conteúdo do .sql>"}
```

Padrão dos scripts `~/apply_migration_*.py`: rodar um SELECT de verificação
antes, aplicar o SQL, repetir a verificação depois (existência da tabela, RLS,
policies, `has_table_privilege` para anon/authenticated/service_role, contagem
de linhas, `storage.buckets.public`).

## Padrão de acesso das tabelas novas

- Tabelas lidas só por server functions (`supabaseAdmin`, service_role):
  `REVOKE ALL ON public.<t> FROM anon, authenticated; GRANT ALL ON public.<t> TO service_role;`
  sem policies CRUD para `authenticated` (padrão de `inadimplencia_fechamento_mensal`).
- Buckets privados: leitura só por `createSignedUrl` no servidor e upload por
  `uploadToSignedUrl` com token emitido por server function; sem policy em
  `storage.objects`.
