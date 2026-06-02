import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─── Phase 6 (Option C migration) ───────────────────────────────────────────
// Sponte inadimplência integration ported from the CRA app's api/sponte-batch.ts
// into a TanStack Start server function. Reuses the validated logic: Query
// Inversion (fetch debts first), boleto grouping, BolsaAssociada discount applied
// only to "Mensalidade", and CEC × CEC Baby segmentation by TurmaAtual.

const SPONTE_URL = "https://api.sponteeducacional.net.br/WSAPIEdu.asmx";
const SPONTE_NS = "http://api.sponteeducacional.net.br/";
const BATCH_SIZE = 50;

// Roteador de unidades Sponte. Cada unidade aponta para o par de variáveis de
// ambiente (código de cliente + token) usado na requisição SOAP, e indica se os
// resultados devem ser filtrados por TurmaAtual.
//
// - CEC e CEC Baby compartilham o MESMO token (atende as duas) e por isso são
//   segmentadas por TurmaAtual (Berçário/Maternal → CEC Baby; Período/Ano → CEC).
// - Núcleo Belvedere usa credenciais EXCLUSIVAS e NÃO possui divisão de turmas,
//   então todo registro retornado por essas credenciais é exibido (sem filtro).
interface UnidadeSponteConfig {
  codigoEnv: string;
  tokenEnv: string;
  segmentaPorTurma: boolean;
}

const SPONTE_UNIDADES: Record<string, UnidadeSponteConfig> = {
  CEC: { codigoEnv: "SPONTE_CODIGO_CLIENTE", tokenEnv: "SPONTE_TOKEN", segmentaPorTurma: true },
  "CEC Baby": {
    codigoEnv: "SPONTE_CODIGO_CLIENTE",
    tokenEnv: "SPONTE_TOKEN",
    segmentaPorTurma: true,
  },
  "Núcleo Belvedere": {
    codigoEnv: "SPONTE_BELVEDERE_CODIGO_CLIENTE",
    tokenEnv: "SPONTE_BELVEDERE_TOKEN",
    segmentaPorTurma: false,
  },
};

const UNIDADES_SPONTE = Object.keys(SPONTE_UNIDADES);

interface SponteCreds {
  codigoCliente: string;
  token: string;
  segmentaPorTurma: boolean;
}

// Resolve as credenciais Sponte para a unidade selecionada. Consolidado (sem
// unidade) usa o token padrão (CEC/CEC Baby) sem filtro de turma, preservando o
// comportamento anterior. Retorna null para unidades sem integração ativa.
function resolverCredenciais(unidade: string | null): SponteCreds | null {
  if (!unidade) {
    const codigoCliente = process.env.SPONTE_CODIGO_CLIENTE;
    const token = process.env.SPONTE_TOKEN;
    if (!codigoCliente || !token) return null;
    return { codigoCliente, token, segmentaPorTurma: false };
  }
  const config = SPONTE_UNIDADES[unidade];
  if (!config) return null;
  const codigoCliente = process.env[config.codigoEnv];
  const token = process.env[config.tokenEnv];
  if (!codigoCliente || !token) return null;
  return { codigoCliente, token, segmentaPorTurma: config.segmentaPorTurma };
}

function buildSoapEnvelope(
  method: string,
  extraParams: string,
  codigoCliente: string,
  token: string,
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${SPONTE_NS}">
      <nCodigoCliente>${codigoCliente}</nCodigoCliente>
      <sToken>${token}</sToken>
      ${extraParams}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
}

function parseXmlValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function parseXmlList(xml: string, itemTag: string): string[] {
  const items: string[] = [];
  const regex = new RegExp(`<${itemTag}[^>]*>[\\s\\S]*?</${itemTag}>`, "gi");
  let m;
  while ((m = regex.exec(xml)) !== null) items.push(m[0]);
  return items;
}

function parseBrDecimal(value: string): number {
  if (!value) return 0;
  return parseFloat(value.replace(/\./g, "").replace(",", ".")) || 0;
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  if (dateStr.includes("/")) {
    const [d, m, y] = dateStr.split("/");
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  if (dateStr.includes("-")) return new Date(dateStr);
  return null;
}

function isInDateRange(vencimento: string, dataInicio: Date, dataFim: Date): boolean {
  const dt = parseDate(vencimento);
  if (!dt) return false;
  return dt >= dataInicio && dt <= dataFim;
}

async function callSponte(
  method: string,
  sParametrosBusca: string,
  codigoCliente: string,
  token: string,
): Promise<string> {
  const extraParams = sParametrosBusca
    ? `<sParametrosBusca>${sParametrosBusca}</sParametrosBusca>`
    : "";
  const soapBody = buildSoapEnvelope(method, extraParams, codigoCliente, token);
  const response = await fetch(SPONTE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `${SPONTE_NS}${method}`,
    },
    body: soapBody,
  });
  return response.text();
}

function checkFault(xml: string): string | null {
  const faultCode = xml.match(/<faultcode>([^<]*)<\/faultcode>/i)?.[1];
  const faultString = xml.match(/<faultstring>([^<]*)<\/faultstring>/i)?.[1];
  if (faultCode || faultString) return faultString || `Fault: ${faultCode}`;
  return null;
}

interface ParcelaRaw {
  alunoId: string;
  nomeAluno: string;
  vencimento: string;
  valor: number;
  valorPago: number;
  saldo: number;
  status: string;
  numeroBoleto: string;
  categoria: string;
  bolsaAssociada: string;
}

export interface PendenciaAgrupada {
  groupKey: string;
  alunoId: string;
  nomeAluno: string;
  nomeResponsavel: string;
  telefone: string;
  vencimento: string;
  valorTotalBoleto: number;
  valorComDesconto: number;
  descontoBolsa: number;
  categorias: string[];
  qtdParcelas: number;
}

export interface SponteBatchResult {
  pendencias: PendenciaAgrupada[];
  indisponivel?: boolean;
  error?: string;
  meta: {
    totalAlunos: number;
    alunosComPendencia: number;
    totalParcelas: number;
    totalBoletos: number;
    tempoSegundos: number;
    dataInicio: string;
    dataFim: string;
  };
}

function extractBolsaPercent(bolsaAssociada: string): number {
  if (!bolsaAssociada) return 0;
  const match = bolsaAssociada.match(/(\d+)[,.]?(\d*)%/);
  if (!match) return 0;
  return parseFloat(`${match[1]}.${match[2] || "0"}`);
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Classifica a unidade pedagógica do aluno a partir do campo TurmaAtual do Sponte.
// CEC Baby: Berçário e Maternal. CEC: Período e Ano (1º Período → 9º Ano).
function classificarUnidade(turmaAtual: string): "CEC" | "CEC Baby" | null {
  if (!turmaAtual) return null;
  const t = normalizar(turmaAtual);
  if (t.includes("bercario") || t.includes("maternal")) return "CEC Baby";
  if (t.includes("periodo") || t.includes("ano")) return "CEC";
  return null;
}

const InputSchema = z.object({
  dataInicio: z.string().min(8),
  dataFim: z.string().min(8),
  unidade: z.string().optional(),
});

export const fetchSponteInadimplencia = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<SponteBatchResult> => {
    const { dataInicio, dataFim, unidade } = data;
    const unidadeKey = unidade ?? null;

    const emptyMeta = {
      totalAlunos: 0,
      alunosComPendencia: 0,
      totalParcelas: 0,
      totalBoletos: 0,
      tempoSegundos: 0,
      dataInicio,
      dataFim,
    };

    // Unidades sem integração Sponte ativa.
    if (unidadeKey !== null && !(unidadeKey in SPONTE_UNIDADES)) {
      return { pendencias: [], indisponivel: true, meta: emptyMeta };
    }

    // Roteador de credenciais: cada unidade usa seu próprio token/código.
    const creds = resolverCredenciais(unidadeKey);
    if (!creds) {
      throw new Error(
        `Credenciais da API do Sponte não configuradas para a unidade "${unidadeKey ?? "consolidado"}".`,
      );
    }
    const { codigoCliente, token } = creds;

    const dtInicio = new Date(dataInicio);
    const dtFim = new Date(dataFim);
    dtFim.setHours(23, 59, 59, 999);
    const startTime = Date.now();

    // ── Step 1: Fetch ALL open parcels in ONE call (Query Inversion) ──
    const parcelasXml = await callSponte("GetParcelas", "Situacao=Aberta", codigoCliente, token);
    const fault = checkFault(parcelasXml);
    if (fault) return { pendencias: [], error: fault, meta: emptyMeta };

    const parcelaNodes = parseXmlList(parcelasXml, "wsParcela");

    // ── Step 2: Filter by date range, collect raw parcelas ──
    const parcelasRaw: ParcelaRaw[] = [];
    const alunosComPendencia = new Set<string>();

    for (const parcela of parcelaNodes) {
      const retorno = parseXmlValue(parcela, "RetornoOperacao");
      if (!retorno.startsWith("01")) continue;
      const situacao = parseXmlValue(parcela, "SituacaoParcela");
      if (situacao === "Quitada" || situacao === "Cancelada") continue;
      const vencimento = parseXmlValue(parcela, "Vencimento");
      if (!isInDateRange(vencimento, dtInicio, dtFim)) continue;
      const valorParcela = parseBrDecimal(parseXmlValue(parcela, "ValorParcela"));
      const valorPago = parseBrDecimal(parseXmlValue(parcela, "ValorPago"));
      const saldo = valorParcela - valorPago;
      if (saldo <= 0) continue;
      const alunoId = parseXmlValue(parcela, "AlunoID");
      if (!alunoId || alunoId === "0") continue;

      alunosComPendencia.add(alunoId);
      parcelasRaw.push({
        alunoId,
        nomeAluno: parseXmlValue(parcela, "Sacado") || "-",
        vencimento,
        valor: valorParcela,
        valorPago,
        saldo,
        status: situacao,
        numeroBoleto: parseXmlValue(parcela, "NumeroBoleto"),
        categoria: parseXmlValue(parcela, "Categoria"),
        bolsaAssociada: parseXmlValue(parcela, "BolsaAssociada"),
      });
    }

    if (parcelasRaw.length === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      return { pendencias: [], meta: { ...emptyMeta, tempoSegundos: parseFloat(elapsed) } };
    }

    // ── Step 3: Fetch student names + responsável ONLY for debtors ──
    const debtorIds = Array.from(alunosComPendencia);
    const alunoNomeMap: Record<string, string> = {};
    const alunoUnidadeMap: Record<string, "CEC" | "CEC Baby" | null> = {};
    const responsaveisMap: Record<string, { nome: string; celular: string }> = {};

    for (let i = 0; i < debtorIds.length; i += BATCH_SIZE) {
      const batch = debtorIds.slice(i, i + BATCH_SIZE);
      const [alunoResults, respResults] = await Promise.all([
        Promise.allSettled(
          batch.map(async (id) => ({
            id,
            xml: await callSponte("GetAlunos", `AlunoID=${id}`, codigoCliente, token),
          })),
        ),
        Promise.allSettled(
          batch.map(async (id) => ({
            id,
            xml: await callSponte(
              "GetResponsavelFinanceiro",
              `AlunoID=${id}`,
              codigoCliente,
              token,
            ),
          })),
        ),
      ]);

      for (const result of alunoResults) {
        if (result.status !== "fulfilled") continue;
        const { id, xml } = result.value;
        const nodes = parseXmlList(xml, "wsAluno");
        if (nodes.length > 0 && parseXmlValue(nodes[0], "RetornoOperacao").startsWith("01")) {
          alunoNomeMap[id] = parseXmlValue(nodes[0], "Nome");
          alunoUnidadeMap[id] = classificarUnidade(parseXmlValue(nodes[0], "TurmaAtual"));
        }
      }
      for (const result of respResults) {
        if (result.status !== "fulfilled") continue;
        const { id, xml } = result.value;
        const nodes = parseXmlList(xml, "wsResponsavel");
        if (nodes.length > 0 && parseXmlValue(nodes[0], "RetornoOperacao").startsWith("01")) {
          responsaveisMap[id] = {
            nome: parseXmlValue(nodes[0], "Nome"),
            celular: parseXmlValue(nodes[0], "Celular") || parseXmlValue(nodes[0], "Telefone"),
          };
        }
      }
    }

    // ── Step 4: Group parcelas by NumeroBoleto (or AlunoID+Vencimento) ──
    const groups: Record<string, ParcelaRaw[]> = {};
    for (const p of parcelasRaw) {
      const key =
        p.numeroBoleto && p.numeroBoleto !== "0"
          ? `bol_${p.numeroBoleto}`
          : `${p.alunoId}_${p.vencimento}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }

    // ── Step 5: Enrich + build grouped pendencias (discount on Mensalidade only) ──
    const pendenciasAgrupadas: PendenciaAgrupada[] = [];
    for (const [groupKey, items] of Object.entries(groups)) {
      const first = items[0];
      const valorTotalBoleto = items.reduce((sum, it) => sum + it.saldo, 0);
      const categorias = [...new Set(items.map((it) => it.categoria).filter(Boolean))];

      let maxBolsaPct = 0;
      let valorMensalidade = 0;
      let valorOutros = 0;
      for (const it of items) {
        const pct = extractBolsaPercent(it.bolsaAssociada);
        if (pct > maxBolsaPct) maxBolsaPct = pct;
        if (it.categoria.toLowerCase() === "mensalidade") valorMensalidade += it.saldo;
        else valorOutros += it.saldo;
      }

      const valorComDesconto =
        maxBolsaPct > 0
          ? Math.round((valorMensalidade * (1 - maxBolsaPct / 100) + valorOutros) * 100) / 100
          : valorTotalBoleto;

      const resp = responsaveisMap[first.alunoId];
      pendenciasAgrupadas.push({
        groupKey,
        alunoId: first.alunoId,
        nomeAluno: alunoNomeMap[first.alunoId] || first.nomeAluno,
        nomeResponsavel: resp ? resp.nome : "-",
        telefone: resp ? resp.celular : "-",
        vencimento: first.vencimento,
        valorTotalBoleto,
        valorComDesconto,
        descontoBolsa: maxBolsaPct,
        categorias,
        qtdParcelas: items.length,
      });
    }

    // ── Step 6: Multi-tenant — filtrar boletos por TurmaAtual quando aplicável ──
    // Belvedere (e o consolidado) não segmentam por turma: exibem todos os
    // registros retornados pelas credenciais usadas.
    const unidadeFiltrada =
      creds.segmentaPorTurma && (unidade === "CEC" || unidade === "CEC Baby") ? unidade : null;
    const pendenciasFinal = unidadeFiltrada
      ? pendenciasAgrupadas.filter((p) => alunoUnidadeMap[p.alunoId] === unidadeFiltrada)
      : pendenciasAgrupadas;

    const parcelasFinal = pendenciasFinal.reduce((sum, p) => sum + p.qtdParcelas, 0);
    const alunosFinal = new Set(pendenciasFinal.map((p) => p.alunoId)).size;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return {
      pendencias: pendenciasFinal,
      meta: {
        totalAlunos: alunosFinal,
        alunosComPendencia: alunosFinal,
        totalParcelas: parcelasFinal,
        totalBoletos: pendenciasFinal.length,
        tempoSegundos: parseFloat(elapsed),
        dataInicio,
        dataFim,
      },
    };
  });
