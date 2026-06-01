Este é um pacote bem grande (3 frentes independentes). Sugiro implementar em fases para você poder validar cada uma antes de seguir. Abaixo o escopo completo e a ordem proposta.

## Fase 1 — Configurações + Dashboard (UI/UX)

**Configurações**
- Renomear aba "Despesas — Centros de Custo" → "Despesas"
- Renomear aba "Receitas — Categorias" → "Receitas"
- Remover o subtítulo "Estrutura hierárquica para classificar entradas…" da aba Receitas
- Adicionar campo `color` em `revenue_categories` (migration) e color picker no CRUD, igual ao de Despesas; exibir bolinha de cor ao lado do nome

**Dashboard**
- Novo gráfico "Receitas por Categoria" ao lado/abaixo do gráfico de Gastos, mesmo estilo visual (BarChart com cores das categorias)
- Substituir "Transações Recentes" por **Extrato Completo**:
  - Filtro de período (Data Inicial / Data Final, com atalho "Mês atual")
  - Botão **"Definir Saldo Inicial"** (salvo por colégio + data de referência em nova tabela `initial_balances`)
  - Coluna extra **"Saldo em Conta"** calculada cronologicamente (saldo inicial + entradas − saídas)
  - KPI "Saldo Final" no topo passa a considerar o saldo inicial
  - Botão **"Exportar para Excel"** (.xlsx via lib `xlsx` já instalada) das transações filtradas

## Fase 2 — Conciliação de Boletos (PDF)

- Nova rota/aba **"Conciliação de Boletos"**
- Upload de PDF → parse com `pdfjs-dist` no client extraindo texto
- Heurística para identificar: data do repasse, valor total, e linhas de pagamento por aluno/subcategoria de receita
- Tela de revisão com mapeamento (subcategoria detectada → `revenue_subcategory_id` existente), editável
- Busca automática no banco por uma transação de **entrada** com mesma data + mesmo valor total (margem ±R$0,01) e do colégio selecionado → alerta verde "Transação Encontrada e Vinculada"
- Botão **"Confirmar Conciliação"**:
  - Apaga a transação consolidada do extrato
  - Insere N transações detalhadas (uma por subcategoria do PDF) com a mesma data, vinculadas a `revenue_category_id`/`revenue_subcategory_id`
  - Operação transacional via server function (`createServerFn`) usando `supabaseAdmin`
- Nova tabela `reconciliations` para auditoria (PDF original opcional via Storage; valor total; data; transações geradas)

**Importante**: a precisão da extração depende do layout do PDF do seu emissor. Se possível, me envie um PDF de exemplo (pode anonimizar) para eu calibrar a heurística — sem isso eu implemento com um parser genérico baseado em padrões comuns (linhas tipo "Nome — Categoria — R$ valor" e total no rodapé), que pode precisar de ajuste.

## Fase 3 — Fluxo Futuro (Despesas Recorrentes)

- Nova rota/aba **"Fluxo Futuro"**
- Função SQL/view que detecta recorrência: agrupa despesas dos últimos 3 meses por chave de similaridade (descrição normalizada + centro de custo) e mantém só as que apareceram ≥1× em cada um dos 3 meses
- Projeção = média dos 3 meses × 1,05
- Tabela exibida mês a mês com navegação (Mês +1, +2, +3…) — período fechado dia 01 → último dia do mês
- Coluna **"Pago?"** (checkbox):
  - Ao marcar abre seletor para vincular à transação real do extrato (mesmo mês, tipo saída, valor próximo)
  - Cria registro em `recurring_payments` ligando previsão ↔ transação; status = "Liquidado"
- Renovação automática: nova tabela `recurring_expense_forecasts` recalculada via cron (pg_cron, dia 01 às 00:05) que regrava previsões do mês corrente

**Detalhe técnico**: a "renovação" automática roda no banco via `pg_cron` chamando uma função PL/pgSQL — não precisa de endpoint externo.

---

## Pergunta antes de começar

Esse escopo é grande (3-4 migrations, ~6-8 arquivos novos, parser de PDF). Quer que eu:

**(A)** Implemente as **3 fases em sequência** nesta mesma resposta (vai ser longo, mas entrego tudo) — recomendado se você quer ver o pacote completo

**(B)** Implemente **apenas a Fase 1** agora (rápida, baixo risco), você valida, e seguimos pra Fase 2 e 3 depois — recomendado se quiser iterar

**(C)** Outra ordem (ex: Fase 1 + Fase 3 primeiro, deixando Conciliação de Boletos por último para você me mandar o PDF de exemplo)

Me diga qual prefere — e, se for (A) ou tiver PDF de exemplo do emissor de boletos, me envie agora para eu calibrar o parser.