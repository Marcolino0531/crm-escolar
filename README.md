# Schooler Hub

ERP escolar multi-unidades (multi-tenant por Colégio). Inclui Admissões (Kanban),
Onboarding, RH e o módulo **Financeiro** (fluxo de caixa, contas a pagar / Fluxo
Futuro, Conciliação de Faturamento e inadimplência via Sponte).

## Stack

- **TanStack Start** (SSR) + **Vite** + **React 19**
- **Supabase** (Postgres) — banco, auth e RBAC
- **Tailwind CSS v4** + shadcn/ui
- **Bun** (gerenciador de pacotes)
- Deploy: Cloudflare Workers (`wrangler`)

> Migrado do app anterior em Create React App. A integração Sponte (SOAP) foi
> mantida e entra como sub-aba do Financeiro.

## Setup

1. Instale o [Bun](https://bun.sh/).
2. Instale as dependências:
   ```bash
   bun install
   ```
3. Copie `.env.example` para `.env` e preencha com as credenciais do projeto Supabase:
   ```bash
   cp .env.example .env
   ```
   Variáveis necessárias:
   - `VITE_SUPABASE_URL` / `SUPABASE_URL` — URL do projeto Supabase
   - `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` — chave anon/public
   - `SUPABASE_SERVICE_ROLE_KEY` — chave service_role (apenas server-side)

## Scripts

```bash
bun run dev      # servidor de desenvolvimento (http://localhost:8080)
bun run build    # build de produção
bun run preview  # preview do build
bun run lint     # eslint
```

## Banco de dados (Supabase)

As migrations ficam em `supabase/migrations/` e definem todo o schema
(transactions, cost_centers, revenue_categories/subcategories, boleto_reconciliations,
initial_balances, recurring_forecasts, user_roles, schools, etc.).

Os `schools` correspondem às Unidades do Schooler Hub:
CEC, CEC Baby, Núcleo Belvedere, Núcleo Vale do Sereno.
