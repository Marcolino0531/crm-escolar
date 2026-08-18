// Endpoint nativo de exportação de pedidos de uniformes em Excel (.xlsx).
// Montado a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET /api/uniformes/export-order  — planilha de reposição (saldo < mínimo)
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

  return json({ ok: false, error: "Rota não encontrada." }, 404);
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

async function exportOrder(url: URL): Promise<Response> {
  const stores = parseStores(url);

  // stores === [] significa unidade selecionada sem nenhuma loja correspondente:
  // nada a exportar.
  if (stores !== null && stores.length === 0) {
    return buildWorkbookResponse([]);
  }

  // O saldo é comparado com o mínimo de cada variação (o PostgREST não compara
  // duas colunas), então a filtragem é feita aqui — daí a paginação, para não
  // parar no teto de linhas por resposta.
  const variants: VariantRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let variantQuery = supabaseAdmin
      .from("uniform_variants" as never)
      .select("ns_variant_id, ns_product_id, store_key, size, sku, stock, min_stock")
      .order("ns_variant_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (stores !== null) variantQuery = variantQuery.in("store_key", stores);
    const { data, error } = await variantQuery;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as VariantRow[];
    variants.push(...batch);
    if (batch.length < PAGE) break;
  }

  let productQuery = supabaseAdmin
    .from("uniform_products" as never)
    .select("ns_product_id, store_key, name");
  if (stores !== null && stores.length > 0) {
    productQuery = productQuery.in("store_key", stores);
  }
  const { data: productsData, error: pErr } = await productQuery;
  if (pErr) throw new Error(pErr.message);
  const products = (productsData ?? []) as unknown as ProductRow[];

  const nameByKey = new Map<string, string>();
  for (const p of products) {
    nameByKey.set(`${p.store_key}:${p.ns_product_id}`, p.name ?? "");
  }

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
