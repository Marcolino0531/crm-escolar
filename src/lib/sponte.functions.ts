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
  // Conta Caixa creditada usada na Conciliação de Faturamento para isolar a
  // unidade (CEC e CEC Baby compartilham o token, mas creditam em contas
  // distintas). null = sem filtro de conta (Belvedere).
  contaCaixa: string | null;
}

const SPONTE_UNIDADES: Record<string, UnidadeSponteConfig> = {
  CEC: {
    codigoEnv: "SPONTE_CODIGO_CLIENTE",
    tokenEnv: "SPONTE_TOKEN",
    segmentaPorTurma: true,
    contaCaixa: "489426",
  },
  "CEC Baby": {
    codigoEnv: "SPONTE_CODIGO_CLIENTE",
    tokenEnv: "SPONTE_TOKEN",
    segmentaPorTurma: true,
    contaCaixa: "011311",
  },
  "Núcleo Belvedere": {
    codigoEnv: "SPONTE_BELVEDERE_CODIGO_CLIENTE",
    tokenEnv: "SPONTE_BELVEDERE_TOKEN",
    segmentaPorTurma: false,
    contaCaixa: null,
  },
};

const UNIDADES_SPONTE = Object.keys(SPONTE_UNIDADES);

interface SponteCreds {
  codigoCliente: string;
  token: string;
  segmentaPorTurma: boolean;
  contaCaixa: string | null;
}

// Resolve as credenciais Sponte de UMA unidade. Retorna null quando a unidade
// não tem integração ativa ou as variáveis de ambiente não estão configuradas.
// O consolidado é tratado no handler, combinando as credenciais de CEC e
// Belvedere explicitamente.
function resolverCredenciais(unidade: string): SponteCreds | null {
  const config = SPONTE_UNIDADES[unidade];
  if (!config) return null;
  const codigoCliente = process.env[config.codigoEnv];
  const token = process.env[config.tokenEnv];
  if (!codigoCliente || !token) return null;
  return {
    codigoCliente,
    token,
    segmentaPorTurma: config.segmentaPorTurma,
    contaCaixa: config.contaCaixa,
  };
}

// Compara a Conta Creditada (ex.: "Caixa - 489426") da parcela com a conta
// caixa configurada da unidade. Normaliza para dígitos e ignora zeros à
// esquerda, casando por igualdade ou sufixo (a conta costuma ser o final do
// rótulo). Retorna true quando bate.
function contaCaixaBate(contaCreditar: string, contaAlvo: string): boolean {
  const soDigitos = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
  const a = soDigitos(contaCreditar);
  const b = soDigitos(contaAlvo);
  if (!b) return false;
  return a === b || a.endsWith(b);
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
  // Unidade pedagógica do boleto (CEC, CEC Baby ou Núcleo Belvedere). Preenchida
  // sobretudo na visão Consolidada para identificar a origem de cada registro.
  unidade?: string;
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

interface ColetaResult {
  pendencias: PendenciaAgrupada[];
  alunoUnidadeMap: Record<string, "CEC" | "CEC Baby" | null>;
  fault?: string;
}

// Núcleo da consulta para UM par de credenciais (código + token): Inversão de
// Busca (GetParcelas primeiro), enriquecimento apenas dos devedores,
// agrupamento por boleto e desconto de pontualidade só na Mensalidade.
// NÃO aplica filtro de turma — quem decide é o chamador (unidade individual vs.
// consolidado). Retorna também o mapa de classificação por aluno (TurmaAtual)
// para que o consolidado possa fazer a soma estrita por série.
async function coletarPendencias(
  codigoCliente: string,
  token: string,
  dtInicio: Date,
  dtFim: Date,
): Promise<ColetaResult> {
  // ── Step 1: Fetch ALL open parcels in ONE call (Query Inversion) ──
  const parcelasXml = await callSponte("GetParcelas", "Situacao=Aberta", codigoCliente, token);
  const fault = checkFault(parcelasXml);
  if (fault) return { pendencias: [], alunoUnidadeMap: {}, fault };

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

  if (parcelasRaw.length === 0) return { pendencias: [], alunoUnidadeMap: {} };

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
          xml: await callSponte("GetResponsavelFinanceiro", `AlunoID=${id}`, codigoCliente, token),
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

  return { pendencias: pendenciasAgrupadas, alunoUnidadeMap };
}

// ─── Conciliação de Faturamento ─────────────────────────────────────────────
// Mesma base (roteamento de credenciais por unidade + Inversão de Busca + filtro
// de série), mas para parcelas BAIXADAS (quitadas) em uma janela de pagamento.
// Serve para conciliar automaticamente as linhas "COB COMPE" do extrato: o
// somatório das parcelas baixadas (por categoria) deve fechar com o valor da
// linha. O rateio retornado é a composição por categoria (Mensalidade, Almoço,
// Hora Extra, etc.).

export interface RateioCategoria {
  categoria: string;
  valor: number;
}

export interface ConciliacaoSponteResult {
  itens: RateioCategoria[];
  total: number;
  qtdParcelas: number;
  qtdBoletos: number;
  indisponivel?: boolean;
  error?: string;
  meta: {
    dataInicio: string;
    dataFim: string;
    tempoSegundos: number;
  };
}

interface BaixadaRaw {
  alunoId: string;
  categoria: string;
  valorPago: number;
  numeroBoleto: string;
}

interface ColetaBaixadasResult {
  parcelas: BaixadaRaw[];
  fault?: string;
}

const FORMA_COBRANCA_BANCARIA = "Cobrança Bancária";

// Núcleo da conciliação para UM par de credenciais. Aplica os TRÊS filtros
// rigorosos que reproduzem o relatório do Sponte usado pelo cliente, para o
// valor fechar exatamente com a linha "COB COMPE" do extrato:
//   1. Tipo de Recebimento = Cobrança Bancária (exclui PIX/dinheiro/cartão);
//   2. Situação = Quitada/Baixada;
//   3. Conta Creditada = a conta caixa da unidade (quando informada).
// O recorte de data usa a DATA DE PAGAMENTO (não vencimento) dentro da janela.
//
// Os parâmetros enviados à API (Situacao;FormaCobranca) reduzem o payload, mas
// a separação por "&" não é aceita pela API — o separador correto é ";". Como a
// API não filtra por data nem honra Situacao de forma confiável, os três
// filtros são reforçados no cliente, que é a fonte da verdade.
async function coletarBaixadas(
  codigoCliente: string,
  token: string,
  dtInicio: Date,
  dtFim: Date,
  contaCaixa: string | null,
): Promise<ColetaBaixadasResult> {
  const params = `Situacao=Quitada;FormaCobranca=${FORMA_COBRANCA_BANCARIA}`;
  const parcelasXml = await callSponte("GetParcelas", params, codigoCliente, token);
  const fault = checkFault(parcelasXml);
  if (fault) return { parcelas: [], fault };

  const parcelaNodes = parseXmlList(parcelasXml, "wsParcela");

  const parcelas: BaixadaRaw[] = [];
  for (const parcela of parcelaNodes) {
    if (!parseXmlValue(parcela, "RetornoOperacao").startsWith("01")) continue;
    // Filtro 2 — Situação Quitada/Baixada.
    if (parseXmlValue(parcela, "SituacaoParcela") !== "Quitada") continue;
    // Filtro 1 — somente Cobrança Bancária (exclui PIX avulso, dinheiro, cartão).
    if (parseXmlValue(parcela, "FormaCobranca") !== FORMA_COBRANCA_BANCARIA) continue;
    // Data de Pagamento (D-1 dia útil) dentro da janela — nunca vencimento.
    const dataPagamento = parseXmlValue(parcela, "DataPagamento");
    if (!isInDateRange(dataPagamento, dtInicio, dtFim)) continue;
    // Filtro 3 — Conta Creditada específica da unidade (Belvedere: sem filtro).
    if (contaCaixa && !contaCaixaBate(parseXmlValue(parcela, "ContaCreditar"), contaCaixa))
      continue;

    const valorPago =
      parseBrDecimal(parseXmlValue(parcela, "ValorPago")) ||
      parseBrDecimal(parseXmlValue(parcela, "ValorParcela"));
    if (valorPago <= 0) continue;
    const alunoId = parseXmlValue(parcela, "AlunoID");

    parcelas.push({
      alunoId,
      categoria: parseXmlValue(parcela, "Categoria") || "Outros",
      valorPago,
      numeroBoleto: parseXmlValue(parcela, "NumeroBoleto"),
    });
  }

  return { parcelas };
}

const ConciliacaoInputSchema = z.object({
  dataInicio: z.string().min(8),
  dataFim: z.string().min(8),
  unidade: z.string().min(1),
});

// Conciliação automática via Sponte (parcelas baixadas → rateio por categoria).
// Roteamento de credenciais idêntico à Inadimplência, mas a separação de
// unidade aqui é pela CONTA CAIXA creditada (como o cliente gera o relatório),
// não por série:
//  - CEC: token compartilhado, conta caixa 489426
//  - CEC Baby: token compartilhado, conta caixa 011311
//  - Núcleo Belvedere: token exclusivo, sem filtro de conta
export const fetchSponteConciliacao = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ConciliacaoInputSchema.parse(input))
  .handler(async ({ data }): Promise<ConciliacaoSponteResult> => {
    const { dataInicio, dataFim, unidade } = data;
    const meta = { dataInicio, dataFim, tempoSegundos: 0 };

    if (!(unidade in SPONTE_UNIDADES)) {
      return { itens: [], total: 0, qtdParcelas: 0, qtdBoletos: 0, indisponivel: true, meta };
    }
    const creds = resolverCredenciais(unidade);
    if (!creds) {
      throw new Error(`Credenciais da API do Sponte não configuradas para a unidade "${unidade}".`);
    }

    const dtInicio = new Date(dataInicio);
    const dtFim = new Date(dataFim);
    dtFim.setHours(23, 59, 59, 999);
    const startTime = Date.now();

    const res = await coletarBaixadas(
      creds.codigoCliente,
      creds.token,
      dtInicio,
      dtFim,
      creds.contaCaixa,
    );
    if (res.fault) {
      return { itens: [], total: 0, qtdParcelas: 0, qtdBoletos: 0, error: res.fault, meta };
    }

    // A separação de unidade já foi aplicada pelo filtro de conta caixa em
    // coletarBaixadas (CEC × CEC Baby por conta; Belvedere sem filtro).
    const parcelas = res.parcelas;

    // Rateio: agrupa o valor pago por categoria (Mensalidade, Almoço, etc.).
    const porCategoria = new Map<string, number>();
    for (const p of parcelas) {
      porCategoria.set(p.categoria, (porCategoria.get(p.categoria) ?? 0) + p.valorPago);
    }
    const itens: RateioCategoria[] = [...porCategoria.entries()]
      .map(([categoria, valor]) => ({ categoria, valor: Math.round(valor * 100) / 100 }))
      .sort((a, b) => b.valor - a.valor);
    const total = Math.round(itens.reduce((s, it) => s + it.valor, 0) * 100) / 100;

    const boletos = new Set(
      parcelas.map((p) =>
        p.numeroBoleto && p.numeroBoleto !== "0" ? `bol_${p.numeroBoleto}` : `aluno_${p.alunoId}`,
      ),
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    return {
      itens,
      total,
      qtdParcelas: parcelas.length,
      qtdBoletos: boletos.size,
      meta: { dataInicio, dataFim, tempoSegundos: parseFloat(elapsed) },
    };
  });

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

    const dtInicio = new Date(dataInicio);
    const dtFim = new Date(dataFim);
    dtFim.setHours(23, 59, 59, 999);
    const startTime = Date.now();

    let pendenciasFinal: PendenciaAgrupada[] = [];

    if (unidadeKey === null) {
      // ── Consolidado: dispara AMBOS os tokens (CEC + Belvedere) em paralelo ──
      // e mescla os resultados, respeitando as regras de separação pedagógica.
      const cecCreds = resolverCredenciais("CEC");
      const belvedereCreds = resolverCredenciais("Núcleo Belvedere");
      if (!cecCreds && !belvedereCreds) {
        throw new Error("Credenciais da API do Sponte não configuradas para o consolidado.");
      }

      const vazio: ColetaResult = { pendencias: [], alunoUnidadeMap: {} };
      const [cecRes, belvedereRes] = await Promise.all([
        cecCreds
          ? coletarPendencias(cecCreds.codigoCliente, cecCreds.token, dtInicio, dtFim)
          : Promise.resolve(vazio),
        belvedereCreds
          ? coletarPendencias(belvedereCreds.codigoCliente, belvedereCreds.token, dtInicio, dtFim)
          : Promise.resolve(vazio),
      ]);

      // Token CEC/CEC Baby → soma ESTRITA das listas filtradas por série:
      // CEC (1º Período–9º Ano) + CEC Baby (Berçário–Maternal 3). Boletos sem
      // classificação pedagógica são descartados (corrige o 29 → 21 + 4).
      const cecPendencias: PendenciaAgrupada[] = cecRes.pendencias
        .filter((p) => cecRes.alunoUnidadeMap[p.alunoId] != null)
        .map((p) => ({ ...p, unidade: cecRes.alunoUnidadeMap[p.alunoId] as string }));

      // Token Belvedere → todos os registros (sem filtro de turma).
      const belvederePendencias: PendenciaAgrupada[] = belvedereRes.pendencias.map((p) => ({
        ...p,
        unidade: "Núcleo Belvedere",
      }));

      pendenciasFinal = [...cecPendencias, ...belvederePendencias];

      // Se nada veio e ambas as fontes falharam, propaga o erro.
      if (pendenciasFinal.length === 0 && (cecRes.fault || belvedereRes.fault)) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        return {
          pendencias: [],
          error: cecRes.fault ?? belvedereRes.fault,
          meta: { ...emptyMeta, tempoSegundos: parseFloat(elapsed) },
        };
      }
    } else {
      // ── Unidade individual: usa EXCLUSIVAMENTE as credenciais da unidade ──
      const creds = resolverCredenciais(unidadeKey);
      if (!creds) {
        throw new Error(
          `Credenciais da API do Sponte não configuradas para a unidade "${unidadeKey}".`,
        );
      }
      const res = await coletarPendencias(creds.codigoCliente, creds.token, dtInicio, dtFim);
      if (res.fault) return { pendencias: [], error: res.fault, meta: emptyMeta };

      // CEC/CEC Baby: filtra por TurmaAtual. Belvedere: exibe todos os registros.
      const filtrarPorTurma =
        creds.segmentaPorTurma && (unidadeKey === "CEC" || unidadeKey === "CEC Baby");
      const lista = filtrarPorTurma
        ? res.pendencias.filter((p) => res.alunoUnidadeMap[p.alunoId] === unidadeKey)
        : res.pendencias;
      pendenciasFinal = lista.map((p) => ({ ...p, unidade: unidadeKey }));
    }

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
