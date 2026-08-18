// Endpoint nativo de exportação de pedidos de uniformes em Excel (.xlsx).
// Montado a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET /api/uniformes/export-order  — planilha de reposição (saldo < mínimo)
//   GET /api/uniformes/vendas        — vendas do ano por peça e tamanho (Nuvemshop)
//
// Respeita a unidade selecionada no header: o frontend envia as lojas
// (`?stores=belvedere,cec`); sem o parâmetro, exporta todas as lojas.

import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { STORES, type StoreKey } from "@/lib/nuvemshop.stores";
import {
  ORDER_QUANTITY,
  linhasDoPedido,
  type LinhaPedido,
  type VariacaoPedido,
} from "@/lib/uniformes.pedido";
import { agregaVendas, type CatalogoVariacoes, type VendaAgregada } from "@/lib/uniformes.vendas";
import { configuredStores, fetchPaidOrders } from "@/lib/nuvemshop.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = bearer(request);
  if (!token) return false;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && !!data?.user;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type VariantRow = VariacaoPedido & { ns_variant_id: string };

type ProductRow = {
  ns_product_id: string;
  store_key: StoreKey;
  name: string | null;
};

export async function handleUniformesApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!pathname.startsWith("/api/uniformes/")) return null;

  if (pathname === "/api/uniformes/export-order" && request.method === "GET") {
    if (!(await isAuthenticated(request))) {
      return json({ ok: false, error: "Sessão inválida — faça login novamente." }, 401);
    }
    try {
      return await exportOrder(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[uniformes] /export-order falhou:", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  if (pathname === "/api/uniformes/vendas" && request.method === "GET") {
    if (!(await isAuthenticated(request))) {
      return json({ ok: false, error: "Sessão inválida — faça login novamente." }, 401);
    }
    try {
      const ano = Number(url.searchParams.get("ano"));
      if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
        return json({ ok: false, error: "Parâmetro 'ano' inválido." }, 400);
      }
      const vendas = await vendasDoAno(ano, parseStores(url));
      return json({ ok: true, ano, vendas });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[uniformes] /vendas falhou:", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  return json({ ok: false, error: "Rota não encontrada." }, 404);
}

// Catálogo espelhado no Supabase: dá o tamanho de cada variação vendida e o nome
// atual de cada peça, sem depender do que ficou gravado no pedido.
async function carregaCatalogo(stores: StoreKey[] | null): Promise<CatalogoVariacoes> {
  const variacoes = await todasAsVariacoes(stores);
  const tamanhoPorVariacao = new Map<string, string>();
  for (const v of variacoes) {
    tamanhoPorVariacao.set(`${v.store_key}:${v.ns_variant_id}`, v.size ?? "");
  }
  const nomePorProduto = await nomesDosProdutos(stores);
  return { tamanhoPorVariacao, nomePorProduto };
}

async function vendasDoAno(ano: number, stores: StoreKey[] | null): Promise<VendaAgregada[]> {
  if (stores !== null && stores.length === 0) return [];

  const catalogo = await carregaCatalogo(stores);
  const permitidas = stores === null ? null : new Set(stores);
  const lojas = configuredStores().filter((s) => permitidas === null || permitidas.has(s.key));
  if (lojas.length === 0) {
    throw new Error(
      "Nenhuma loja Nuvemshop configurada para a unidade selecionada: defina NUVEMSHOP_<LOJA>_STORE_ID e NUVEMSHOP_<LOJA>_TOKEN.",
    );
  }

  // A API filtra por data de CRIAÇÃO e a venda é contada pela data de PAGAMENTO,
  // então a janela começa antes do ano para alcançar o pedido criado em novembro
  // e pago em janeiro. Pedido criado depois de 31/12 não pode ter sido pago no ano.
  const createdMin = `${ano - 1}-11-01T00:00:00-03:00`;
  const createdMax = `${ano}-12-31T23:59:59-03:00`;

  const vendas: VendaAgregada[] = [];
  for (const loja of lojas) {
    const pedidos = await fetchPaidOrders(loja, createdMin, createdMax);
    vendas.push(...agregaVendas(loja.key, pedidos, ano, catalogo));
  }
  return vendas;
}

function parseStores(url: URL): StoreKey[] | null {
  const raw = url.searchParams.get("stores");
  if (!raw || raw === "all") return null;
  const valid = new Set(STORES.map((s) => s.key));
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is StoreKey => valid.has(s as StoreKey));
  return keys.length > 0 ? keys : [];
}

// Variações espelhadas das lojas pedidas (`null` = todas). O saldo é comparado
// com o mínimo de cada variação e o PostgREST não compara duas colunas, então a
// filtragem acontece em memória — daí a paginação, para não parar no teto de
// linhas por resposta.
async function todasAsVariacoes(stores: StoreKey[] | null): Promise<VariantRow[]> {
  const variants: VariantRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin
      .from("uniform_variants" as never)
      .select("ns_variant_id, ns_product_id, store_key, size, sku, stock, min_stock")
      .order("ns_variant_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (stores !== null) query = query.in("store_key", stores);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as VariantRow[];
    variants.push(...batch);
    if (batch.length < PAGE) break;
  }
  return variants;
}

// `${storeKey}:${ns_product_id}` → nome do produto.
async function nomesDosProdutos(stores: StoreKey[] | null): Promise<Map<string, string>> {
  let query = supabaseAdmin
    .from("uniform_products" as never)
    .select("ns_product_id, store_key, name");
  if (stores !== null) query = query.in("store_key", stores);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const nameByKey = new Map<string, string>();
  for (const p of (data ?? []) as unknown as ProductRow[]) {
    nameByKey.set(`${p.store_key}:${p.ns_product_id}`, p.name ?? "");
  }
  return nameByKey;
}

async function exportOrder(url: URL): Promise<Response> {
  const stores = parseStores(url);

  // stores === [] significa unidade selecionada sem nenhuma loja correspondente:
  // nada a exportar.
  if (stores !== null && stores.length === 0) {
    return buildWorkbookResponse([]);
  }

  const variants = await todasAsVariacoes(stores);
  const nameByKey = await nomesDosProdutos(stores);
  return buildWorkbookResponse(linhasDoPedido(variants, nameByKey));
}

async function buildWorkbookResponse(rows: LinhaPedido[]): Promise<Response> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "School Hub";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Pedido de Uniformes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const columns = [
    { header: "Unidade / Loja", key: "loja", width: 24 },
    { header: "Peça", key: "peca", width: 36 },
    { header: "Tamanho", key: "tamanho", width: 12 },
    { header: "SKU", key: "sku", width: 18 },
    { header: "Saldo Atual", key: "saldo", width: 14 },
    { header: "Quantidade a Solicitar", key: "solicitar", width: 22 },
  ];
  sheet.columns = columns.map((c) => ({ key: c.key, width: c.width }));

  // Cabeçalho estilizado (slate dessaturado, fonte branca).
  const headerRow = sheet.getRow(1);
  columns.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header;
  });
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = thinBorder("FFE2E8F0");
  });

  rows.forEach((r) => {
    const row = sheet.addRow(r);
    row.eachCell((cell) => {
      cell.border = thinBorder("FFE2E8F0");
      cell.alignment = { vertical: "middle" };
    });
    row.getCell("tamanho").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("saldo").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("solicitar").alignment = { vertical: "middle", horizontal: "center" };
    // Destaca o saldo crítico em vermelho dessaturado.
    row.getCell("saldo").font = { color: { argb: "FFB91C1C" }, bold: true };
  });

  // Linha de Total Geral somando a coluna "Quantidade a Solicitar" via =SUM().
  const firstDataRow = 2;
  const lastDataRow = rows.length + 1;
  const totalRow = sheet.addRow({});
  const totalRowNumber = totalRow.number;
  totalRow.getCell("sku").value = "Total Geral";
  totalRow.getCell("solicitar").value =
    rows.length > 0
      ? { formula: `SUM(F${firstDataRow}:F${lastDataRow})`, result: rows.length * ORDER_QUANTITY }
      : 0;
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.border = thinBorder("FFCBD5E1");
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });
  totalRow.getCell("sku").alignment = { horizontal: "right" };
  totalRow.getCell("solicitar").alignment = { horizontal: "center" };
  // Garante a borda mesmo nas células vazias da linha de total.
  for (let c = 1; c <= columns.length; c++) {
    const cell = sheet.getRow(totalRowNumber).getCell(c);
    cell.border = thinBorder("FFCBD5E1");
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const today = new Date().toISOString().slice(0, 10);
  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pedido-uniformes-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

function thinBorder(argb: string) {
  const side = { style: "thin" as const, color: { argb } };
  return { top: side, left: side, bottom: side, right: side };
}
