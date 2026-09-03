# Leituras no Supabase: paginação obrigatória (teto de 1000 linhas)

## O problema

O PostgREST (API do Supabase) devolve **no máximo 1000 linhas por requisição**
(`db-max-rows`). Quando uma consulta bate nesse teto, **não há erro**: a
resposta simplesmente vem incompleta. Isso já causou bugs reais no School Hub:

- Colônia de Férias (#191): validador acusava registros "faltando" que existiam.
- Extrato Bancário (#251): lançamentos sumiam da lista.
- Diário do Aluno (#320): plano de refeições salvo aparecia como "SEM PLANO",
  gerando cobrança extra indevida — o salvar apaga e reinsere, e as linhas novas
  caíam além da 1000ª.

Somas, contagens e "quem já recebeu hoje" ficam **silenciosamente errados**.

## A regra

> Toda leitura que possa devolver mais de 1000 linhas — hoje ou no futuro —
> DEVE usar `selectAll` / `fetchAllRows` de `src/lib/supabase-paginate.ts`.

Na dúvida, pagine. O custo é uma requisição extra a cada 1000 linhas; o custo
de não paginar é dado financeiro errado sem ninguém perceber.

Se enquadram na regra, sem exceção:

- listas que crescem com o tempo (alunos, leads, funcionários, conversas,
  mensagens, logs de cobrança, transações, previsões, variantes de uniforme);
- qualquer agregação/soma/contagem feita no cliente ou no servidor;
- checagens de duplicidade ou idempotência ("já existe?", "já foi enviado?");
- padrões de apagar-e-reinserir (as linhas novas ficam no fim da tabela).

Não precisam paginar:

- `.single()` / `.maybeSingle()`;
- contagem no banco: `.select("id", { count: "exact", head: true })`;
- `.limit(n)` **intencional** para uma janela funcional (ex.: últimas 500
  mensagens no contexto da IA) — documente a intenção num comentário;
- tabelas de catálogo pequenas e estáveis (ex.: `schools`, `cost_centers`).

## Como usar

```ts
import { selectAll } from "@/lib/supabase-paginate";

const alunos = await selectAll<StudentRow>(() =>
  supabase
    .from("diario_students")
    .select("id, name, class_name")
    .eq("school_id", schoolId)
    .order("name")
    .order("id"), // ordenação determinística: obrigatória para as páginas não se sobreporem
);
```

- A fábrica é chamada uma vez por página (os builders do Supabase são de uso
  único); monte a consulta inteira dentro dela.
- **Sempre termine com um `.order` determinístico** (normalmente `id`). Sem
  isso o PostgREST pode devolver a mesma linha em duas páginas ou pular linhas.
- Erros de qualquer página são **lançados** (nunca vira lista parcial). Trate
  com `try/catch` se a tela precisar de fallback.
- Filtros de unidade/RLS continuam iguais; a paginação só divide a leitura.

Para casos em que você já tem o `.range` na mão, use `fetchAllRows((from, to) => ...)`.

## Testes

Módulos que somam dinheiro devem ter teste simulando o PostgREST (corte em
1000) e um volume acima disso — ver `src/lib/financeiro-ia.paginacao.test.ts`
e `src/lib/supabase-paginate.test.ts`.

## Revisão de código

Ao revisar (ou escrever) um `.from(...).select(...)`, pergunte: "essa tabela
pode um dia ter mais de 1000 linhas que passem nesses filtros?" Se sim, ou se
não souber, exija `selectAll`.
