import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
  // distintas; Belvedere usa token próprio e credita na 9295). null = sem
  // filtro de conta.
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
    contaCaixa: "9295",
  },
  // Vale do Sereno usa credenciais EXCLUSIVAS e NÃO divide turmas (como o
  // Belvedere). As variáveis são populadas no painel da Vercel.
  "Núcleo Vale do Sereno": {
    codigoEnv: "SPONTE_VALE_SERENO_CODIGO",
    tokenEnv: "SPONTE_VALE_SERENO_SENHA",
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

// ─── RBAC por unidade (server-side) ──────────────────────────────────────────
// Retorna os NOMES das escolas (= chaves Sponte) que o usuário pode acessar, ou
// `null` para acesso global (apenas admin). Fail-closed: um usuário não-admin
// sem nenhuma unidade vinculada recebe `[]` (acesso NEGADO a tudo, inclusive ao
// consolidado "Todas as Unidades"). Usado para impedir que um usuário restrito
// force, via requisição forjada, a leitura de dados fora da sua permissão.
async function allowedSponteUnidades(userId: string): Promise<string[] | null> {
  const { data: roles } = await supabaseAdmin
    .from("user_roles" as any)
    .select("role")
    .eq("user_id", userId);
  if (((roles ?? []) as any[]).some((r) => r.role === "admin")) return null;

  const { data: us } = await supabaseAdmin
    .from("user_schools" as any)
    .select("school_id")
    .eq("user_id", userId);
  const ids = ((us ?? []) as any[]).map((r) => r.school_id as string);
  if (ids.length === 0) return []; // fail-closed: sem vínculo = nenhuma unidade

  const { data: schools } = await supabaseAdmin
    .from("schools" as any)
    .select("name")
    .in("id", ids);
  return ((schools ?? []) as any[]).map((s) => s.name as string);
}

// Casa o nome da Conta Creditada (ex.: "Caixa - 489426") com a conta-caixa da
// unidade usando .includes — tanto no texto cru ("011311") quanto só nos
// dígitos. NÃO removemos zeros à esquerda: a conta do CEC Baby ("011311")
// precisa casar literalmente.
function contaCaixaBate(contaTexto: string, contaAlvo: string): boolean {
  if (!contaTexto || !contaAlvo) return false;
  if (contaTexto.includes(contaAlvo)) return true;
  const soDigitos = (s: string) => s.replace(/\D/g, "");
  const a = soDigitos(contaTexto);
  const b = soDigitos(contaAlvo);
  return !!b && a.includes(b);
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

// Remove acentos, baixa caixa e colapsa espaços — para comparar rótulos do
// Sponte (FormaCobranca, SituacaoParcela) sem depender de acentuação/caixa.
function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Converte uma data do Sponte ("DD/MM/YYYY" ou "YYYY-MM-DD[...]") para o
// formato de calendário "YYYY-MM-DD". É TIMEZONE-SAFE: trabalha só com os
// componentes da string, sem criar Date (a Vercel roda em UTC e new Date()
// deslocaria o dia). Retorna null quando não reconhece.
function paraYMD(dateStr: string): string | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  if (s.includes("/")) {
    const [d, m, y] = s.split(" ")[0].split("/");
    if (!d || !m || !y) return null;
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (s.includes("-")) return s.slice(0, 10);
  return null;
}

// Janela por calendário (strings "YYYY-MM-DD"), comparação lexicográfica —
// independe de fuso horário do servidor.
function dataNaJanela(dataSponte: string, inicioYMD: string, fimYMD: string): boolean {
  const p = paraYMD(dataSponte);
  if (!p) return false;
  return p >= inicioYMD && p <= fimYMD;
}

// "YYYY-MM-DD" -> "DD/MM/YYYY" (formato que o filtro DataPagamento do Sponte
// espera no sParametrosBusca). TIMEZONE-SAFE: só manipula a string.
function ymdParaBr(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

// Lista os dias de calendário (YYYY-MM-DD) entre início e fim, inclusive. Usa
// aritmética em UTC só para o passo de +1 dia (sem deslocamento de fuso) e
// reformata para string. `maxDias` é um teto de segurança contra payloads
// patológicos (31 nos blocos mensais; maior na busca por período customizado,
// que pode cobrir vários meses — limitada pelo timeout da API, não pelo dia).
function diasNaJanela(inicioYMD: string, fimYMD: string, maxDias = 31): string[] {
  const dias: string[] = [];
  const [yi, mi, di] = inicioYMD.split("-").map(Number);
  const [yf, mf, df] = fimYMD.split("-").map(Number);
  let cur = Date.UTC(yi, mi - 1, di);
  const end = Date.UTC(yf, mf - 1, df);
  for (let i = 0; cur <= end && i < maxDias; i++) {
    const dt = new Date(cur);
    const ymd = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    dias.push(ymd);
    cur += 86400000;
  }
  return dias;
}

// Código numérico da situação "Quitada" no filtro Situacao do Sponte
// (0=Pendente, 1=Quitada). Confirmado contra a API real.
const SITUACAO_QUITADA = "1";

// Lê o primeiro tag não-vazio dentre vários nomes candidatos (o Sponte varia o
// nome do campo de data/valor de baixa entre contas).
function primeiroValor(xmlNode: string, tags: string[]): string {
  for (const t of tags) {
    const v = parseXmlValue(xmlNode, t);
    if (v) return v;
  }
  return "";
}

// Candidatos de nome do campo de DATA DE PAGAMENTO/BAIXA (varia por conta).
const TAGS_DATA_PAGAMENTO = [
  "DataPagamento",
  "DataBaixa",
  "DataCredito",
  "DataRecebimento",
  "DataQuitacao",
  "DataLiquidacao",
  "DataPgto",
];
// Candidatos de nome do campo de VALOR PAGO/RECEBIDO (cai para ValorParcela).
const TAGS_VALOR_PAGO = ["ValorPago", "ValorRecebido", "ValorBaixa", "ValorParcela"];
// Situações que indicam parcela liquidada (normalizadas).
const SITUACOES_BAIXADA = new Set([
  "quitada",
  "quitado",
  "baixada",
  "baixado",
  "paga",
  "pago",
  "recebida",
  "recebido",
  "liquidada",
  "liquidado",
]);

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
  // Soma dos itens/composições do boleto classificados como "Acordo" (saldo).
  // Permite descontar item a item — sem remover o boleto inteiro nos cálculos
  // de "Sem Acordos" / Inadimplência Acumulada.
  valorAcordo: number;
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
  inicioYMD: string,
  fimYMD: string,
): Promise<ColetaResult> {
  // ── Step 1: Buscar boletos em aberto VENCIDO A VENCIDO no mês selecionado ──
  // O GetParcelas com `Situacao=Aberta` (sem data) devolve um lote TRUNCADO
  // (~7000), dominado por vencimentos futuros, que corta justamente os boletos
  // vencidos de ex-alunos. O filtro por data de vencimento (`DataVencimento`) é
  // honrado pela API e devolve o conjunto COMPLETO daquele dia — de TODOS os
  // alunos (ativos, inativos, transferidos, formados), sem truncar. Iteramos os
  // dias da janela e unimos os resultados. O teto é elevado (≈6 meses) para
  // permitir a busca por período customizado; janelas longas demais simplesmente
  // estouram o timeout de 60s da API e o frontend trata isso com aviso amigável.
  const dias = diasNaJanela(inicioYMD, fimYMD, 186);
  const parcelaNodes: string[] = [];
  let primeiroFault: string | null = null;
  const DIAS_CONC = 10; // janela de concorrência para não estourar a API/timeout
  for (let i = 0; i < dias.length; i += DIAS_CONC) {
    const lote = dias.slice(i, i + DIAS_CONC);
    const resultados = await Promise.allSettled(
      lote.map((dia) =>
        callSponte(
          "GetParcelas",
          `DataVencimento=${ymdParaBr(dia)};Situacao=Aberta`,
          codigoCliente,
          token,
        ),
      ),
    );
    for (const r of resultados) {
      if (r.status !== "fulfilled") continue;
      const fault = checkFault(r.value);
      if (fault) {
        if (!primeiroFault) primeiroFault = fault;
        continue;
      }
      for (const node of parseXmlList(r.value, "wsParcela")) parcelaNodes.push(node);
    }
  }
  // Só propaga erro se NENHUM dia retornou parcelas (falha geral de credencial).
  if (parcelaNodes.length === 0 && primeiroFault) {
    return { pendencias: [], alunoUnidadeMap: {}, fault: primeiroFault };
  }

  // ── Step 2: Filter by status/saldo, collect raw parcelas ──
  const parcelasRaw: ParcelaRaw[] = [];
  const alunosComPendencia = new Set<string>();

  for (const parcela of parcelaNodes) {
    const retorno = parseXmlValue(parcela, "RetornoOperacao");
    if (!retorno.startsWith("01")) continue;
    const situacao = parseXmlValue(parcela, "SituacaoParcela");
    if (situacao === "Quitada" || situacao === "Cancelada") continue;
    const vencimento = parseXmlValue(parcela, "Vencimento");
    // Reforço por calendário: a API já recortou por DataVencimento, mas
    // garantimos que a parcela está estritamente dentro da janela do mês.
    if (!dataNaJanela(vencimento, inicioYMD, fimYMD)) continue;
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
    const valorAcordo = items.reduce(
      (sum, it) => sum + (normalizar(it.categoria).includes("acordo") ? it.saldo : 0),
      0,
    );
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
      valorAcordo,
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

// Diagnóstico de produção: quantos registros sobraram após cada filtro e quais
// rótulos o Sponte realmente retornou. Vai pro frontend (mensagem de erro) e pro
// console da Vercel para depurar quando a soma não fechar.
export interface ConciliacaoDiagnostico {
  totalNos: number;
  comFormaBancaria: number;
  comSituacaoBaixada: number;
  comDataNaJanela: number;
  comContaCorreta: number;
  somaEncontrada: number;
  situacoesVistas: string[];
  formasVistas: string[];
  contasVistas: string[];
}

export interface ConciliacaoSponteResult {
  itens: RateioCategoria[];
  total: number;
  qtdParcelas: number;
  qtdBoletos: number;
  indisponivel?: boolean;
  error?: string;
  diagnostico?: ConciliacaoDiagnostico;
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
  diagnostico: ConciliacaoDiagnostico;
  fault?: string;
}

// Reconhece liquidações que caem no crédito bancário agregado do extrato — a
// linha "COB COMPE" (Caixa) / "BOLETOS RECEBIDOS" (Itaú). Ou seja, somente
// boletos compensados ("Cobrança Bancária" / "Boleto Bancário"). Exclui PIX,
// dinheiro, cartão etc., que NÃO entram nessa linha do banco. O rótulo varia,
// então casamos por inclusão normalizada (sem acento/caixa).
function ehRecebimentoBancario(forma: string): boolean {
  const f = normalizarTexto(forma);
  return f.includes("cobranca bancaria") || f.includes("boleto");
}

// Reconhece liquidações via PIX no rateio (TipoRecebimento = "Pix"). Usado pela
// conciliação automática de PIX, que casa cada linha PIX do extrato com a baixa
// correspondente do Sponte por valor exato + similaridade de nome.
function ehRecebimentoPix(forma: string): boolean {
  return normalizarTexto(forma).includes("pix");
}

function topContagem(mapa: Map<string, number>, n = 8): string[] {
  return [...mapa.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k || "(vazio)"}×${v}`);
}

// Núcleo da conciliação para UM par de credenciais. Aplica os TRÊS filtros
// rigorosos que reproduzem o relatório do Sponte usado pelo cliente, para o
// valor fechar com a linha "COB COMPE" do extrato:
//   1. Forma de Recebimento = Cobrança Bancária (exclui PIX/dinheiro/cartão);
//   2. Situação = Quitada/Baixada (qualquer rótulo de liquidação);
//   3. Conta Creditada = a conta caixa da unidade (quando informada).
// O recorte de data usa a DATA DE PAGAMENTO/BAIXA (não vencimento), comparada
// por CALENDÁRIO (string YYYY-MM-DD), o que independe do fuso UTC da Vercel.
//
// Robustez: como a sandbox só expõe parcelas pendentes, os nomes dos campos de
// baixada (data/valor) e os rótulos (situação/forma) são casados por candidatos
// e normalização, e tudo é instrumentado em `diagnostico` para depurar produção.
//
// FILTRO NA ORIGEM (API-side): o GetParcelas, sem filtro válido, devolve um lote
// truncado (~7000) só de PENDENTES e nunca chega às quitadas — por isso a soma
// dava R$ 0,00. A chamada agora força os filtros que o Sponte realmente honra:
//   • Situacao=1  → somente parcelas QUITADAS (0=Pendente, 1=Quitada);
//   • DataPagamento=DD/MM/YYYY → recorte server-side pela data de PAGAMENTO.
// Isso reduz o payload para as poucas baixadas do dia (sem truncamento). Como a
// data de pagamento é um dia específico, varremos cada dia da janela (D-1 dia
// útil normalmente é 1 dia) e acumulamos. O separador é ";" (o "&" quebra o XML).
// Os filtros de Forma de Cobrança e Conta Creditada (por unidade) seguem
// aplicados no cliente, pois não são honrados pela API. Tudo instrumentado em
// `diagnostico` para depurar produção.
async function coletarBaixadas(
  codigoCliente: string,
  token: string,
  inicioYMD: string,
  fimYMD: string,
  contaCaixa: string | null,
): Promise<ColetaBaixadasResult> {
  // Contadores e amostras de rótulos para diagnóstico.
  const situacoes = new Map<string, number>();
  const formas = new Map<string, number>();
  const contas = new Map<string, number>();
  const diag: ConciliacaoDiagnostico = {
    totalNos: 0,
    comFormaBancaria: 0,
    comSituacaoBaixada: 0,
    comDataNaJanela: 0,
    comContaCorreta: 0,
    somaEncontrada: 0,
    situacoesVistas: [],
    formasVistas: [],
    contasVistas: [],
  };

  const parcelas: BaixadaRaw[] = [];
  const dias = diasNaJanela(inicioYMD, fimYMD);
  let primeiroFault: string | null = null;

  for (const diaYMD of dias) {
    const params = `Situacao=${SITUACAO_QUITADA};DataPagamento=${ymdParaBr(diaYMD)}`;
    const parcelasXml = await callSponte("GetParcelas", params, codigoCliente, token);
    const retorno = parseXmlValue(parcelasXml, "RetornoOperacao");
    const fault = checkFault(parcelasXml);
    if (fault && !primeiroFault) primeiroFault = fault;

    const parcelaNodes = parseXmlList(parcelasXml, "wsParcela");
    diag.totalNos += parcelaNodes.length;

    // Logs de diagnóstico por dia (Vercel → Functions → Logs).
    console.log("[CONC][Sponte] GetParcelas", {
      url: SPONTE_URL,
      metodo: "GetParcelas",
      params,
      retorno,
      contaCaixa: contaCaixa ?? "(sem filtro)",
      nos: parcelaNodes.length,
    });

    for (const parcela of parcelaNodes) {
      if (!parseXmlValue(parcela, "RetornoOperacao").startsWith("01")) continue;

      const situacaoRaw = parseXmlValue(parcela, "SituacaoParcela");
      const formaRaw = parseXmlValue(parcela, "FormaCobranca");
      situacoes.set(situacaoRaw, (situacoes.get(situacaoRaw) ?? 0) + 1);
      formas.set(formaRaw, (formas.get(formaRaw) ?? 0) + 1);

      // CONTA DA BAIXA REAL = ContaCreditada dentro de RateioLancamentos. O
      // ContaCreditar de topo é só a conta PREVISTA e vem sempre igual (ex.:
      // "Caixa - 489426"), por isso casava 0 no CEC Baby. Quando não há rateio,
      // cai para o ContaCreditar de topo.
      const rateioNodes = parseXmlList(parcela, "wsRateioLancamento");
      const contasReais = rateioNodes.length
        ? rateioNodes.map((r) => parseXmlValue(r, "ContaCreditada"))
        : [parseXmlValue(parcela, "ContaCreditar")];
      for (const c of contasReais) contas.set(c, (contas.get(c) ?? 0) + 1);

      // Situação já garantida pela API (Situacao=1); reforço por segurança.
      if (!SITUACOES_BAIXADA.has(normalizarTexto(situacaoRaw))) continue;
      diag.comSituacaoBaixada++;

      // Data de pagamento já garantida pela API; reforço por calendário.
      const dataPagamento = primeiroValor(parcela, TAGS_DATA_PAGAMENTO);
      if (!dataNaJanela(dataPagamento, inicioYMD, fimYMD)) continue;
      diag.comDataNaJanela++;

      const categoria = parseXmlValue(parcela, "Categoria") || "Outros";
      const alunoId = parseXmlValue(parcela, "AlunoID");
      const numeroBoleto = parseXmlValue(parcela, "NumeroBoleto");

      // Filtros de FORMA (boleto) + CONTA da baixa real, somados juntos porque a
      // forma REAL de liquidação está no RATEIO (TipoRecebimento), não na parcela:
      // a FormaCobranca da parcela vem "Cobrança Bancária" mesmo quando o boleto
      // foi PAGO via PIX — e esse PIX NÃO entra no "BOLETOS RECEBIDOS"/"COB COMPE"
      // do banco, inflando a soma (era a causa do CEC nunca fechar). Por isso o
      // filtro de boleto é por rateio. Sem conta configurada (fallback): usa a
      // forma da parcela. CEC/CEC Baby/Belvedere: soma só os rateios na conta-
      // caixa da unidade E liquidados via boleto (trata baixas divididas entre
      // contas).
      let valorNaConta: number;
      if (!contaCaixa) {
        valorNaConta = ehRecebimentoBancario(formaRaw)
          ? parseBrDecimal(primeiroValor(parcela, TAGS_VALOR_PAGO))
          : 0;
      } else if (rateioNodes.length) {
        valorNaConta = rateioNodes
          .filter(
            (r) =>
              contaCaixaBate(parseXmlValue(r, "ContaCreditada"), contaCaixa) &&
              ehRecebimentoBancario(parseXmlValue(r, "TipoRecebimento")),
          )
          .reduce((s, r) => s + parseBrDecimal(parseXmlValue(r, "ValorPagoRateado")), 0);
      } else {
        valorNaConta =
          contaCaixaBate(parseXmlValue(parcela, "ContaCreditar"), contaCaixa) &&
          ehRecebimentoBancario(formaRaw)
            ? parseBrDecimal(primeiroValor(parcela, TAGS_VALOR_PAGO))
            : 0;
      }
      if (valorNaConta <= 0) continue;
      // Contribuiu via boleto na conta certa (funil de diagnóstico).
      diag.comFormaBancaria++;
      diag.comContaCorreta++;

      parcelas.push({ alunoId, categoria, valorPago: valorNaConta, numeroBoleto });
    }
  }

  diag.somaEncontrada = Math.round(parcelas.reduce((s, p) => s + p.valorPago, 0) * 100) / 100;
  diag.situacoesVistas = topContagem(situacoes);
  diag.formasVistas = topContagem(formas);
  diag.contasVistas = topContagem(contas);

  console.log(
    "[CONC][Sponte] diagnóstico",
    JSON.stringify({ janela: `${inicioYMD}..${fimYMD}`, dias, ...diag }),
  );

  // Só propaga fault se nenhuma parcela foi coletada (um dia sem registros não é erro).
  if (primeiroFault && parcelas.length === 0) {
    return { parcelas: [], diagnostico: diag, fault: primeiroFault };
  }
  return { parcelas, diagnostico: diag };
}

const ConciliacaoInputSchema = z.object({
  dataInicio: z.string().min(8),
  dataFim: z.string().min(8),
  unidade: z.string().min(1),
  // Override de Conta Creditada passado pelo cliente. Usado para tentar contas
  // alternativas (ex.: Belvedere credita boletos na 9295 e na 1137). Quando
  // ausente, usa a conta padrão configurada da unidade.
  contaCreditada: z.string().min(1).optional(),
});

// Conciliação automática via Sponte (parcelas baixadas → rateio por categoria).
// Roteamento de credenciais idêntico à Inadimplência, mas a separação de
// unidade aqui é pela CONTA CAIXA creditada (como o cliente gera o relatório),
// não por série:
//  - CEC: token compartilhado, conta caixa 489426
//  - CEC Baby: token compartilhado, conta caixa 011311
//  - Núcleo Belvedere: token exclusivo, conta caixa 9295
export const fetchSponteConciliacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConciliacaoInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ConciliacaoSponteResult> => {
    const { dataInicio, dataFim, unidade, contaCreditada } = data;
    const meta = { dataInicio, dataFim, tempoSegundos: 0 };

    // RBAC por unidade: bloqueia se o usuário não pode acessar a unidade pedida.
    const allowed = await allowedSponteUnidades(context.userId);
    if (allowed !== null && !allowed.includes(unidade)) {
      return { itens: [], total: 0, qtdParcelas: 0, qtdBoletos: 0, meta };
    }

    if (!(unidade in SPONTE_UNIDADES)) {
      return { itens: [], total: 0, qtdParcelas: 0, qtdBoletos: 0, indisponivel: true, meta };
    }
    const creds = resolverCredenciais(unidade);
    if (!creds) {
      throw new Error(`Credenciais da API do Sponte não configuradas para a unidade "${unidade}".`);
    }

    // Janela tratada como CALENDÁRIO (YYYY-MM-DD), sem criar Date — evita o
    // deslocamento de dia causado pelo fuso UTC da Vercel.
    const inicioYMD = paraYMD(dataInicio) ?? dataInicio.slice(0, 10);
    const fimYMD = paraYMD(dataFim) ?? dataFim.slice(0, 10);
    const startTime = Date.now();

    // O cliente pode forçar uma conta creditada específica (ex.: dupla conta do
    // Belvedere: 9295 e 1137); senão usa a conta padrão da unidade.
    const contaAlvo = contaCreditada ?? creds.contaCaixa;
    const res = await coletarBaixadas(
      creds.codigoCliente,
      creds.token,
      inicioYMD,
      fimYMD,
      contaAlvo,
    );
    if (res.fault) {
      return {
        itens: [],
        total: 0,
        qtdParcelas: 0,
        qtdBoletos: 0,
        error: res.fault,
        diagnostico: res.diagnostico,
        meta,
      };
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
      diagnostico: res.diagnostico,
      meta: { dataInicio, dataFim, tempoSegundos: parseFloat(elapsed) },
    };
  });

// ─── Conciliação automática de PIX ──────────────────────────────────────────
// Diferente da conciliação "COB COMPE" (que casa UMA linha agregada do extrato
// com o somatório das baixadas bancárias do dia), o PIX cai no extrato como
// LANÇAMENTOS INDIVIDUAIS ("PIX RECEBIDO FULANO..."). Por isso aqui devolvemos a
// lista de PAGAMENTOS PIX baixados no dia, cada um com os nomes envolvidos
// (aluno, sacado, responsável financeiro, pai/mãe) e o rateio por categoria. O
// frontend faz a triangulação por valor exato + similaridade de nome e aplica a
// prevenção de colisão (mesmo valor + nome ambíguo → mantém pendente).

export interface PixPagamentoSponte {
  // Identificador do pagamento (boleto, ou aluno+data quando sem boleto).
  pagamentoId: string;
  alunoId: string;
  nomeAluno: string;
  dataPagamento: string; // YYYY-MM-DD
  valor: number;
  // Nomes candidatos para o "fuzzy match" com a descrição do extrato.
  nomes: string[];
  // Rateio por categoria (Mensalidade, Material, etc.) da parcela PIX.
  itens: RateioCategoria[];
}

export interface ConciliacaoPixResult {
  pagamentos: PixPagamentoSponte[];
  indisponivel?: boolean;
  error?: string;
  meta: {
    dataInicio: string;
    dataFim: string;
    tempoSegundos: number;
  };
}

interface PixParcelaRaw {
  alunoId: string;
  categoria: string;
  valor: number; // porção PIX do rateio
  numeroBoleto: string;
  sacado: string;
  dataPagamento: string; // YYYY-MM-DD
}

// Coleta as parcelas QUITADAS via PIX numa janela. Mesma estratégia de filtro na
// origem da conciliação bancária (Situacao=1;DataPagamento=DD/MM/YYYY por dia),
// mas seleciona o rateio cujo TipoRecebimento é "Pix" (e não Cobrança Bancária).
async function coletarPixBaixadas(
  codigoCliente: string,
  token: string,
  inicioYMD: string,
  fimYMD: string,
): Promise<{ parcelas: PixParcelaRaw[]; fault?: string }> {
  const dias = diasNaJanela(inicioYMD, fimYMD);
  const parcelas: PixParcelaRaw[] = [];
  let primeiroFault: string | null = null;

  for (const diaYMD of dias) {
    const params = `Situacao=${SITUACAO_QUITADA};DataPagamento=${ymdParaBr(diaYMD)}`;
    const xml = await callSponte("GetParcelas", params, codigoCliente, token);
    const fault = checkFault(xml);
    if (fault && !primeiroFault) primeiroFault = fault;

    for (const parcela of parseXmlList(xml, "wsParcela")) {
      if (!parseXmlValue(parcela, "RetornoOperacao").startsWith("01")) continue;
      const dataPag = primeiroValor(parcela, TAGS_DATA_PAGAMENTO);
      if (!dataNaJanela(dataPag, inicioYMD, fimYMD)) continue;

      // A forma REAL de liquidação está no rateio (TipoRecebimento). Somamos só
      // a porção paga via PIX (um boleto pode ter rateio misto, raro).
      const rateios = parseXmlList(parcela, "wsRateioLancamento");
      const pixValor = rateios
        .filter((r) => ehRecebimentoPix(parseXmlValue(r, "TipoRecebimento")))
        .reduce((s, r) => s + parseBrDecimal(parseXmlValue(r, "ValorPagoRateado")), 0);
      if (pixValor <= 0) continue;

      const alunoId = parseXmlValue(parcela, "AlunoID");
      if (!alunoId || alunoId === "0") continue;

      parcelas.push({
        alunoId,
        categoria: parseXmlValue(parcela, "Categoria") || "Outros",
        valor: pixValor,
        numeroBoleto: parseXmlValue(parcela, "NumeroBoleto"),
        sacado: parseXmlValue(parcela, "Sacado"),
        dataPagamento: paraYMD(dataPag) ?? diaYMD,
      });
    }
  }

  if (primeiroFault && parcelas.length === 0) return { parcelas: [], fault: primeiroFault };
  return { parcelas };
}

const PixInputSchema = z.object({
  dataInicio: z.string().min(8),
  dataFim: z.string().min(8),
  unidade: z.string().min(1),
});

export const fetchSpontePix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PixInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ConciliacaoPixResult> => {
    const { dataInicio, dataFim, unidade } = data;
    const meta = { dataInicio, dataFim, tempoSegundos: 0 };

    // RBAC por unidade.
    const allowed = await allowedSponteUnidades(context.userId);
    if (allowed !== null && !allowed.includes(unidade)) {
      return { pagamentos: [], meta };
    }
    if (!(unidade in SPONTE_UNIDADES)) {
      return { pagamentos: [], indisponivel: true, meta };
    }
    const creds = resolverCredenciais(unidade);
    if (!creds) {
      throw new Error(`Credenciais da API do Sponte não configuradas para a unidade "${unidade}".`);
    }

    const inicioYMD = paraYMD(dataInicio) ?? dataInicio.slice(0, 10);
    const fimYMD = paraYMD(dataFim) ?? dataFim.slice(0, 10);
    const startTime = Date.now();

    const res = await coletarPixBaixadas(creds.codigoCliente, creds.token, inicioYMD, fimYMD);
    if (res.fault) {
      return { pagamentos: [], error: res.fault, meta };
    }

    // Agrupa por boleto (várias categorias de um mesmo boleto entram no mesmo
    // pagamento PIX); sem boleto, agrupa por aluno+data.
    const groups = new Map<string, PixParcelaRaw[]>();
    for (const p of res.parcelas) {
      const key =
        p.numeroBoleto && p.numeroBoleto !== "0"
          ? `bol_${p.numeroBoleto}`
          : `${p.alunoId}_${p.dataPagamento}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    // Enriquece nomes (aluno + responsável financeiro + pai/mãe) e turma para a
    // segmentação CEC × CEC Baby (que compartilham token).
    const alunoIds = [...new Set(res.parcelas.map((p) => p.alunoId))];
    const nomeMap: Record<string, string> = {};
    const turmaClass: Record<string, "CEC" | "CEC Baby" | null> = {};
    const respFinMap: Record<string, string> = {};
    const familiaresMap: Record<string, string[]> = {};

    for (let i = 0; i < alunoIds.length; i += BATCH_SIZE) {
      const batch = alunoIds.slice(i, i + BATCH_SIZE);
      const [alunoResults, respResults] = await Promise.all([
        Promise.allSettled(
          batch.map(async (id) => ({
            id,
            xml: await callSponte("GetAlunos", `AlunoID=${id}`, creds.codigoCliente, creds.token),
          })),
        ),
        Promise.allSettled(
          batch.map(async (id) => ({
            id,
            xml: await callSponte(
              "GetResponsavelFinanceiro",
              `AlunoID=${id}`,
              creds.codigoCliente,
              creds.token,
            ),
          })),
        ),
      ]);

      for (const result of alunoResults) {
        if (result.status !== "fulfilled") continue;
        const { id, xml } = result.value;
        const nodes = parseXmlList(xml, "wsAluno");
        if (nodes.length > 0 && parseXmlValue(nodes[0], "RetornoOperacao").startsWith("01")) {
          nomeMap[id] = parseXmlValue(nodes[0], "Nome");
          turmaClass[id] = classificarUnidade(parseXmlValue(nodes[0], "TurmaAtual"));
          familiaresMap[id] = parseXmlList(nodes[0], "wsResponsaveis")
            .map((w) => parseXmlValue(w, "Nome"))
            .filter(Boolean);
        }
      }
      for (const result of respResults) {
        if (result.status !== "fulfilled") continue;
        const { id, xml } = result.value;
        const nodes = parseXmlList(xml, "wsResponsavel");
        if (nodes.length > 0 && parseXmlValue(nodes[0], "RetornoOperacao").startsWith("01")) {
          respFinMap[id] = parseXmlValue(nodes[0], "Nome");
        }
      }
    }

    const pagamentos: PixPagamentoSponte[] = [];
    for (const [key, items] of groups) {
      const first = items[0];
      // Segmentação CEC × CEC Baby por turma. Mantém os de turma desconhecida no
      // CEC (bucket padrão); a triangulação por valor + nome no frontend é a
      // garantia final contra alocação errada.
      if (creds.segmentaPorTurma) {
        const cls = turmaClass[first.alunoId];
        if (cls && cls !== unidade) continue;
        if (!cls && unidade === "CEC Baby") continue;
      }

      const porCategoria = new Map<string, number>();
      for (const it of items) {
        porCategoria.set(it.categoria, (porCategoria.get(it.categoria) ?? 0) + it.valor);
      }
      const itens: RateioCategoria[] = [...porCategoria.entries()]
        .map(([categoria, valor]) => ({ categoria, valor: Math.round(valor * 100) / 100 }))
        .sort((a, b) => b.valor - a.valor);
      const valor = Math.round(itens.reduce((s, it) => s + it.valor, 0) * 100) / 100;

      const nomes = [
        ...new Set(
          [
            nomeMap[first.alunoId],
            first.sacado,
            respFinMap[first.alunoId],
            ...(familiaresMap[first.alunoId] ?? []),
          ].filter((n): n is string => !!n && n.trim().length > 0),
        ),
      ];

      pagamentos.push({
        pagamentoId: key,
        alunoId: first.alunoId,
        nomeAluno: nomeMap[first.alunoId] || first.sacado || "-",
        dataPagamento: first.dataPagamento,
        valor,
        nomes,
        itens,
      });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    return {
      pagamentos,
      meta: { dataInicio, dataFim, tempoSegundos: parseFloat(elapsed) },
    };
  });

const InputSchema = z.object({
  dataInicio: z.string().min(8),
  dataFim: z.string().min(8),
  unidade: z.string().optional(),
});

// Núcleo de coleta de inadimplência por ESCOPO (unidade individual ou
// consolidado), já com o tratamento de RBAC por unidade, a separação
// pedagógica (CEC/CEC Baby por turma) e a marcação de `unidade` em cada
// pendência. Reutilizado tanto pela visão mensal (fetchSponteInadimplencia)
// quanto pela acumulada anual (fetchSponteInadimplenciaAnual). Retorna apenas
// as pendências (ou error/indisponivel); cada chamador monta seu próprio meta.
async function coletarInadimplenciaPorEscopo(
  unidadeKey: string | null,
  inicioYMD: string,
  fimYMD: string,
  userId: string,
): Promise<{ pendencias: PendenciaAgrupada[]; error?: string; indisponivel?: boolean }> {
  // RBAC por unidade (server-side): impede que um usuário restrito force a
  // leitura de unidades fora da sua permissão (ou do consolidado). `null` =
  // acesso global.
  const allowed = await allowedSponteUnidades(userId);
  const isAllowed = (u: string) => allowed === null || allowed.includes(u);

  // Unidade específica fora da permissão do usuário → bloqueia (lista vazia).
  if (unidadeKey !== null && !isAllowed(unidadeKey)) {
    return { pendencias: [] };
  }

  // Unidades sem integração Sponte ativa.
  if (unidadeKey !== null && !(unidadeKey in SPONTE_UNIDADES)) {
    return { pendencias: [], indisponivel: true };
  }

  if (unidadeKey === null) {
    // ── Consolidado: dispara AMBOS os tokens (CEC + Belvedere) em paralelo ──
    // e mescla os resultados, respeitando as regras de separação pedagógica.
    // RBAC: só busca os tokens das unidades que o usuário pode ver. Um usuário
    // restrito que force o consolidado recebe apenas suas unidades permitidas.
    const cecAllowed = isAllowed("CEC") || isAllowed("CEC Baby");
    const belvedereAllowed = isAllowed("Núcleo Belvedere");
    const valeSerenoAllowed = isAllowed("Núcleo Vale do Sereno");
    const cecCreds = cecAllowed ? resolverCredenciais("CEC") : null;
    const belvedereCreds = belvedereAllowed ? resolverCredenciais("Núcleo Belvedere") : null;
    const valeSerenoCreds = valeSerenoAllowed ? resolverCredenciais("Núcleo Vale do Sereno") : null;
    if (!cecCreds && !belvedereCreds && !valeSerenoCreds) {
      // Usuário restrito sem nenhuma unidade Sponte permitida → lista vazia.
      if (allowed !== null) return { pendencias: [] };
      throw new Error("Credenciais da API do Sponte não configuradas para o consolidado.");
    }

    const vazio: ColetaResult = { pendencias: [], alunoUnidadeMap: {} };
    const [cecRes, belvedereRes, valeSerenoRes] = await Promise.all([
      cecCreds
        ? coletarPendencias(cecCreds.codigoCliente, cecCreds.token, inicioYMD, fimYMD)
        : Promise.resolve(vazio),
      belvedereCreds
        ? coletarPendencias(belvedereCreds.codigoCliente, belvedereCreds.token, inicioYMD, fimYMD)
        : Promise.resolve(vazio),
      valeSerenoCreds
        ? coletarPendencias(valeSerenoCreds.codigoCliente, valeSerenoCreds.token, inicioYMD, fimYMD)
        : Promise.resolve(vazio),
    ]);

    // Token CEC/CEC Baby → CEC (1º Período–9º Ano) + CEC Baby (Berçário–
    // Maternal 3). Ex-alunos (inativos/transferidos/formados) não têm mais
    // TurmaAtual, então caem como null: NÃO os descartamos — atribuímos à
    // unidade-mãe "CEC" para que suas pendências entrem no consolidado.
    // RBAC: o token CEC/CEC Baby é compartilhado, então um usuário com acesso
    // só a CEC (ou só a CEC Baby) deve ver apenas a sua fatia — filtramos pela
    // unidade resolvida por turma.
    const cecPendencias: PendenciaAgrupada[] = cecRes.pendencias
      .map((p) => ({
        ...p,
        unidade: cecRes.alunoUnidadeMap[p.alunoId] ?? "CEC",
      }))
      .filter((p) => isAllowed(p.unidade));

    // Token Belvedere → todos os registros (sem filtro de turma).
    const belvederePendencias: PendenciaAgrupada[] = belvedereRes.pendencias.map((p) => ({
      ...p,
      unidade: "Núcleo Belvedere",
    }));

    // Token Vale do Sereno → todos os registros (sem filtro de turma).
    const valeSerenoPendencias: PendenciaAgrupada[] = valeSerenoRes.pendencias.map((p) => ({
      ...p,
      unidade: "Núcleo Vale do Sereno",
    }));

    const pendencias = [...cecPendencias, ...belvederePendencias, ...valeSerenoPendencias];

    // Se nada veio e todas as fontes falharam, propaga o erro.
    if (pendencias.length === 0 && (cecRes.fault || belvedereRes.fault || valeSerenoRes.fault)) {
      return { pendencias: [], error: cecRes.fault ?? belvedereRes.fault ?? valeSerenoRes.fault };
    }
    return { pendencias };
  }

  // ── Unidade individual: usa EXCLUSIVAMENTE as credenciais da unidade ──
  const creds = resolverCredenciais(unidadeKey);
  if (!creds) {
    throw new Error(
      `Credenciais da API do Sponte não configuradas para a unidade "${unidadeKey}".`,
    );
  }
  const res = await coletarPendencias(creds.codigoCliente, creds.token, inicioYMD, fimYMD);
  if (res.fault) return { pendencias: [], error: res.fault };

  // CEC/CEC Baby compartilham o token e são separados por TurmaAtual.
  // Ex-alunos (sem turma → null) são atribuídos à unidade-mãe "CEC": no
  // filtro "CEC" eles aparecem; em "CEC Baby" só entram quem tem turma de
  // Berçário/Maternal. Belvedere (token próprio) exibe todos os registros.
  const filtrarPorTurma =
    creds.segmentaPorTurma && (unidadeKey === "CEC" || unidadeKey === "CEC Baby");
  const lista = !filtrarPorTurma
    ? res.pendencias
    : unidadeKey === "CEC"
      ? res.pendencias.filter((p) => (res.alunoUnidadeMap[p.alunoId] ?? "CEC") === "CEC")
      : res.pendencias.filter((p) => res.alunoUnidadeMap[p.alunoId] === "CEC Baby");
  return { pendencias: lista.map((p) => ({ ...p, unidade: unidadeKey })) };
}

export const fetchSponteInadimplencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<SponteBatchResult> => {
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

    // Janela do mês em "YYYY-MM-DD" (timezone-safe): a coleta filtra por
    // DataVencimento dia a dia dentro dessa janela.
    const inicioYMD = paraYMD(dataInicio) ?? dataInicio.slice(0, 10);
    const fimYMD = paraYMD(dataFim) ?? dataFim.slice(0, 10);
    const startTime = Date.now();

    const coleta = await coletarInadimplenciaPorEscopo(
      unidadeKey,
      inicioYMD,
      fimYMD,
      context.userId,
    );
    if (coleta.indisponivel) return { pendencias: [], indisponivel: true, meta: emptyMeta };
    if (coleta.error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      return {
        pendencias: [],
        error: coleta.error,
        meta: { ...emptyMeta, tempoSegundos: parseFloat(elapsed) },
      };
    }
    const pendenciasFinal = coleta.pendencias;

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

// ── Inadimplência Acumulada (Ano) ──────────────────────────────────────────
// Numerador do card anual: total de títulos VENCIDOS E NÃO PAGOS desde
// 01/01 do ano corrente até hoje, por unidade, REMOVENDO completamente
// qualquer boleto de "Acordo" (renegociação) para não inflar o indicador com
// dívidas que já foram parceladas/renegociadas. A janela longa pode ser lenta
// na API do Sponte, então o frontend isola este cálculo com skeleton próprio.
export interface InadimplenciaAnualResult {
  totalInadimplente: number;
  totalBoletos: number;
  boletosAcordoExcluidos: number;
  indisponivel?: boolean;
  error?: string;
  tempoSegundos: number;
  dataInicio: string;
  dataFim: string;
}

export const fetchSponteInadimplenciaAnual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<InadimplenciaAnualResult> => {
    const { dataInicio, dataFim, unidade } = data;
    const unidadeKey = unidade ?? null;

    const inicioYMD = paraYMD(dataInicio) ?? dataInicio.slice(0, 10);
    const fimYMD = paraYMD(dataFim) ?? dataFim.slice(0, 10);
    const startTime = Date.now();

    const base = {
      totalInadimplente: 0,
      totalBoletos: 0,
      boletosAcordoExcluidos: 0,
      tempoSegundos: 0,
      dataInicio: inicioYMD,
      dataFim: fimYMD,
    };

    const coleta = await coletarInadimplenciaPorEscopo(
      unidadeKey,
      inicioYMD,
      fimYMD,
      context.userId,
    );
    const tempoSegundos = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
    if (coleta.indisponivel) return { ...base, tempoSegundos, indisponivel: true };
    if (coleta.error) return { ...base, tempoSegundos, error: coleta.error };

    // Filtro Anti-Duplicidade (CRÍTICO): desconta ITEM A ITEM apenas a parcela
    // "Acordo" de cada boleto. Boletos mistos seguem somando o restante
    // (Mensalidade/Material/etc.); só sai do cálculo o valor renegociado.
    const totalInadimplente = coleta.pendencias.reduce(
      (sum, p) => sum + (p.valorTotalBoleto - p.valorAcordo),
      0,
    );
    const boletosAcordoExcluidos = coleta.pendencias.filter((p) => p.valorAcordo > 0).length;
    const totalBoletos = coleta.pendencias.filter(
      (p) => p.valorTotalBoleto - p.valorAcordo > 0.005,
    ).length;

    return {
      totalInadimplente: Math.round(totalInadimplente * 100) / 100,
      totalBoletos,
      boletosAcordoExcluidos,
      tempoSegundos,
      dataInicio: inicioYMD,
      dataFim: fimYMD,
    };
  });

// ── Cobrança: dados do Responsável Financeiro p/ Notificação Extrajudicial ──
// Puxa do Sponte (GetResponsavelFinanceiro) os dados cadastrais completos do
// responsável (Nome, CPF, endereço) e o nome do aluno, usados para montar o
// documento de Notificação Extrajudicial (Pré-judicial) quando o boleto atinge
// 30 dias de atraso. RBAC por unidade aplicado (server-side).
export interface ResponsavelCobranca {
  alunoId: string;
  nomeAluno: string;
  nomeResponsavel: string;
  cpf: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  email: string;
  telefone: string;
  indisponivel?: boolean;
  error?: string;
}

const RespCobrancaInputSchema = z.object({
  alunoId: z.string().min(1),
  unidade: z.string().min(1),
});

export const fetchResponsavelCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RespCobrancaInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ResponsavelCobranca> => {
    const { alunoId, unidade } = data;
    const vazio: ResponsavelCobranca = {
      alunoId,
      nomeAluno: "",
      nomeResponsavel: "",
      cpf: "",
      endereco: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      estado: "",
      cep: "",
      email: "",
      telefone: "",
    };

    // RBAC por unidade: bloqueia leitura fora da permissão do usuário.
    const allowed = await allowedSponteUnidades(context.userId);
    if (allowed !== null && !allowed.includes(unidade)) {
      return { ...vazio, error: "Sem permissão para esta unidade." };
    }

    const creds = resolverCredenciais(unidade);
    if (!creds) return { ...vazio, indisponivel: true };

    try {
      const [respXml, alunoXml] = await Promise.all([
        callSponte(
          "GetResponsavelFinanceiro",
          `AlunoID=${alunoId}`,
          creds.codigoCliente,
          creds.token,
        ),
        callSponte("GetAlunos", `AlunoID=${alunoId}`, creds.codigoCliente, creds.token),
      ]);

      const respNodes = parseXmlList(respXml, "wsResponsavel");
      const r = respNodes[0] ?? "";
      const alunoNodes = parseXmlList(alunoXml, "wsAluno");
      const a = alunoNodes[0] ?? "";

      const pick = (node: string, ...tags: string[]): string => {
        for (const t of tags) {
          const v = parseXmlValue(node, t);
          if (v) return v;
        }
        return "";
      };

      return {
        alunoId,
        nomeAluno: pick(a, "Nome"),
        nomeResponsavel: pick(r, "Nome"),
        cpf: pick(r, "CPF", "Cpf", "CPF_CNPJ"),
        endereco: pick(r, "Endereco", "Logradouro"),
        numero: pick(r, "Numero"),
        complemento: pick(r, "Complemento"),
        bairro: pick(r, "Bairro"),
        cidade: pick(r, "Cidade"),
        estado: pick(r, "Estado", "UF"),
        cep: pick(r, "CEP", "Cep"),
        email: pick(r, "Email"),
        telefone: pick(r, "Celular", "Telefone"),
      };
    } catch (e) {
      return { ...vazio, error: e instanceof Error ? e.message : "Falha ao consultar o Sponte." };
    }
  });

// ── Alunos Matriculados Ativos (Dashboard) ──────────────────────────────────
// Consulta o número REAL de alunos com Situação "Ativo" no Sponte, por unidade.
// GetAlunos com `Situacao=-1` (ID da situação "Ativo", ver GetSituacoesAlunos)
// devolve apenas os matriculados ativos, cada um com seu `TurmaAtual`. Para o
// token CEC/CEC Baby (compartilhado), separamos por turma (Berçário/Maternal →
// CEC Baby; Período/Ano → CEC). Belvedere e Vale do Sereno têm token próprio e
// contam todos. RBAC por unidade aplicado (server-side).
export interface AlunosAtivosResult {
  total: number;
  porUnidade: Record<string, number>;
  indisponivel?: boolean;
  error?: string;
}

const AlunosAtivosInputSchema = z.object({
  unidade: z.string().optional(),
});

// ID da situação "Ativo" no Sponte (negativo, conforme GetSituacoesAlunos).
const SITUACAO_ATIVO = "-1";

// Conta os alunos ativos de UM par de credenciais. Quando `segmentaPorTurma`,
// devolve a separação CEC × CEC Baby; caso contrário, tudo em `total`.
async function contarAtivosPorToken(
  codigoCliente: string,
  token: string,
): Promise<{ cec: number; cecBaby: number; total: number }> {
  const xml = await callSponte("GetAlunos", `Situacao=${SITUACAO_ATIVO}`, codigoCliente, token);
  const fault = checkFault(xml);
  if (fault) throw new Error(fault);
  const nodes = parseXmlList(xml, "wsAluno");
  let cec = 0;
  let cecBaby = 0;
  let total = 0;
  for (const node of nodes) {
    const alunoId = parseXmlValue(node, "AlunoID");
    // O nó de status (RetornoOperacao) vem com AlunoID=0 quando não há registros.
    if (!alunoId || alunoId === "0") continue;
    total++;
    const unidade = classificarUnidade(parseXmlValue(node, "TurmaAtual"));
    if (unidade === "CEC Baby") cecBaby++;
    else cec++; // null (sem turma classificável) cai na unidade-mãe CEC
  }
  return { cec, cecBaby, total };
}

export const fetchSponteAlunosAtivos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AlunosAtivosInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<AlunosAtivosResult> => {
    const unidadeKey = data.unidade ?? null;

    // RBAC por unidade (server-side). `null` = acesso global (admin).
    const allowed = await allowedSponteUnidades(context.userId);
    const isAllowed = (u: string) => allowed === null || allowed.includes(u);

    const porUnidade: Record<string, number> = {};

    try {
      if (unidadeKey === null) {
        // ── Consolidado: CEC token (CEC + CEC Baby) + Belvedere + Vale do Sereno.
        if (isAllowed("CEC") || isAllowed("CEC Baby")) {
          const creds = resolverCredenciais("CEC");
          if (creds) {
            const c = await contarAtivosPorToken(creds.codigoCliente, creds.token);
            if (isAllowed("CEC")) porUnidade["CEC"] = c.cec;
            if (isAllowed("CEC Baby")) porUnidade["CEC Baby"] = c.cecBaby;
          }
        }
        for (const u of ["Núcleo Belvedere", "Núcleo Vale do Sereno"]) {
          if (!isAllowed(u)) continue;
          const creds = resolverCredenciais(u);
          if (!creds) continue;
          const c = await contarAtivosPorToken(creds.codigoCliente, creds.token);
          porUnidade[u] = c.total;
        }
      } else {
        if (!isAllowed(unidadeKey)) {
          return { total: 0, porUnidade: {}, error: "Sem permissão para esta unidade." };
        }
        const creds = resolverCredenciais(unidadeKey);
        if (!creds) return { total: 0, porUnidade: {}, indisponivel: true };
        const c = await contarAtivosPorToken(creds.codigoCliente, creds.token);
        if (creds.segmentaPorTurma) {
          porUnidade[unidadeKey] = unidadeKey === "CEC Baby" ? c.cecBaby : c.cec;
        } else {
          porUnidade[unidadeKey] = c.total;
        }
      }
    } catch (e) {
      return {
        total: 0,
        porUnidade: {},
        error: e instanceof Error ? e.message : "Falha ao consultar o Sponte.",
      };
    }

    if (Object.keys(porUnidade).length === 0) {
      return { total: 0, porUnidade: {}, indisponivel: true };
    }
    const total = Object.values(porUnidade).reduce((s, n) => s + n, 0);
    return { total, porUnidade };
  });

// ── Benefícios da Colônia de Férias (crédito de hora extra + isenção de refeição) ──
// Consulta, por aluno, as parcelas do Sponte (GetParcelas por AlunoID) e extrai:
//  • o valor mensal de "Hora Extra" pago na mensalidade → banco de crédito;
//  • quais refeições estão inclusas na mensalidade → isenção na colônia.
// A trava de calendário (só Julho/Dezembro) é aplicada no cliente; aqui apenas
// devolvemos os dados brutos consultados por unidade.
const REFEICAO_LABEL_TO_TYPE: { needle: string; type: string }[] = [
  { needle: "lanche da manha", type: "breakfast" },
  { needle: "lanche da tarde", type: "snack" },
  { needle: "almoco", type: "lunch" },
  { needle: "jantar", type: "dinner" },
];

export interface ColoniaBeneficioAluno {
  creditoHoraExtra: number;
  refeicoesIsentas: string[]; // record types: breakfast | lunch | snack | dinner
}

export interface ColoniaBeneficiosResult {
  beneficios: Record<string, ColoniaBeneficioAluno>;
  indisponivel?: boolean;
  error?: string;
}

const ColoniaBeneficiosInputSchema = z.object({
  unidade: z.string(),
  mes: z.number().int().min(1).max(12),
  ano: z.number().int().min(2000).max(2100),
  alunoIds: z.array(z.string()).max(400),
});

// Extrai crédito de hora extra e refeições inclusas de UM conjunto de parcelas.
function extrairBeneficioParcelas(
  parcelaNodes: string[],
  mes: number,
  ano: number,
): ColoniaBeneficioAluno {
  const refeicoesIsentas = new Set<string>();
  let creditoDoMes = 0;
  let creditoFallback = 0;
  let melhorYMD = "";

  for (const p of parcelaNodes) {
    const categoria = parseXmlValue(p, "Categoria");
    if (!categoria) continue;
    const cat = normalizarTexto(categoria);

    const refeicao = REFEICAO_LABEL_TO_TYPE.find((r) => cat.includes(r.needle));
    if (refeicao) {
      refeicoesIsentas.add(refeicao.type);
      continue;
    }

    if (cat.includes("hora extra")) {
      const valor = parseBrDecimal(parseXmlValue(p, "ValorParcela"));
      const ymd = paraYMD(parseXmlValue(p, "Vencimento"));
      if (ymd) {
        const [y, m] = ymd.split("-").map(Number);
        if (y === ano && m === mes) creditoDoMes = valor;
        // Fallback: parcela de hora extra mais recente até o fim do mês de ref.
        const fimRefYMD = `${ano}-${String(mes).padStart(2, "0")}-31`;
        if (ymd <= fimRefYMD && ymd >= melhorYMD) {
          melhorYMD = ymd;
          creditoFallback = valor;
        }
      } else if (creditoFallback === 0) {
        creditoFallback = valor;
      }
    }
  }

  return {
    creditoHoraExtra: creditoDoMes > 0 ? creditoDoMes : creditoFallback,
    refeicoesIsentas: [...refeicoesIsentas],
  };
}

export const fetchColoniaBeneficios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ColoniaBeneficiosInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ColoniaBeneficiosResult> => {
    const { unidade, mes, ano, alunoIds } = data;

    const allowed = await allowedSponteUnidades(context.userId);
    if (allowed !== null && !allowed.includes(unidade)) {
      return { beneficios: {}, error: "Sem permissão para esta unidade." };
    }

    const creds = resolverCredenciais(unidade);
    if (!creds) return { beneficios: {}, indisponivel: true };

    const beneficios: Record<string, ColoniaBeneficioAluno> = {};
    const CONC = 8; // concorrência para não estourar o timeout da API
    try {
      for (let i = 0; i < alunoIds.length; i += CONC) {
        const lote = alunoIds.slice(i, i + CONC);
        const resultados = await Promise.allSettled(
          lote.map((id) =>
            callSponte("GetParcelas", `AlunoID=${id}`, creds.codigoCliente, creds.token),
          ),
        );
        resultados.forEach((r, idx) => {
          if (r.status !== "fulfilled") return;
          if (checkFault(r.value)) return;
          const nodes = parseXmlList(r.value, "wsParcela");
          beneficios[lote[idx]] = extrairBeneficioParcelas(nodes, mes, ano);
        });
      }
    } catch (e) {
      return {
        beneficios,
        error: e instanceof Error ? e.message : "Falha ao consultar o Sponte.",
      };
    }

    return { beneficios };
  });

// ── Sincronização do Diário do Aluno a partir do Sponte ──────────────────────
// Popula/atualiza diario_classes e diario_students usando o Sponte como fonte da
// verdade (turmas, alunos e matrículas ATIVAS). Idempotente: os alunos são
// casados por (school_id, sponte_aluno_id); as fotos existentes nunca são
// sobrescritas. Somente administradores podem executar (escreve em TODAS as
// unidades via service role).

export interface DiarioSyncResult {
  turmas: number;
  alunos: number;
  porUnidade: Record<string, number>;
  indisponivel?: boolean;
  error?: string;
}

interface AlunoAtivo {
  sponteId: string;
  nome: string;
  turma: string;
}

// Lista os alunos ativos de UM par de credenciais (Nome, AlunoID, TurmaAtual).
async function listarAlunosAtivos(codigoCliente: string, token: string): Promise<AlunoAtivo[]> {
  const xml = await callSponte("GetAlunos", `Situacao=${SITUACAO_ATIVO}`, codigoCliente, token);
  const fault = checkFault(xml);
  if (fault) throw new Error(fault);
  const nodes = parseXmlList(xml, "wsAluno");
  const alunos: AlunoAtivo[] = [];
  for (const node of nodes) {
    const sponteId = parseXmlValue(node, "AlunoID");
    if (!sponteId || sponteId === "0") continue;
    alunos.push({
      sponteId,
      nome: parseXmlValue(node, "Nome").trim(),
      turma: parseXmlValue(node, "TurmaAtual").trim(),
    });
  }
  return alunos;
}

// Regra estrita de distribuição do token compartilhado CEC/CEC Baby: turmas de
// Berçário até Maternal 3 vão obrigatoriamente para "CEC Baby"; todas as demais
// (Jardim, Períodos, Anos etc.) vão para "CEC".
function unidadeDestinoDiario(turma: string): "CEC" | "CEC Baby" {
  const t = normalizar(turma);
  if (t.includes("bercario") || t.includes("maternal")) return "CEC Baby";
  return "CEC";
}

// Núcleo do sync do Diário (sem auth) — reutilizado pelo botão manual (admin) e
// pelo cron diário (/api/diario/cron). Escreve via service role.
export async function runDiarioSponteSync(): Promise<DiarioSyncResult> {
  {
    // Mapa nome da unidade → school_id (as unidades Sponte casam com schools.name).
    const { data: schoolRows } = await supabaseAdmin.from("schools" as any).select("id, name");
    const schoolIdByName: Record<string, string> = {};
    for (const s of (schoolRows ?? []) as any[]) schoolIdByName[s.name as string] = s.id as string;

    // Coleta os alunos ativos por unidade de destino (school name).
    // Cada aluno: { schoolName, className, name, sponteId }.
    const coletados: { schoolName: string; className: string; name: string; sponteId: string }[] =
      [];
    const porUnidade: Record<string, number> = {};

    try {
      // CEC token (compartilhado): separa CEC × CEC Baby por TurmaAtual.
      const credsCec = resolverCredenciais("CEC");
      if (credsCec) {
        const alunos = await listarAlunosAtivos(credsCec.codigoCliente, credsCec.token);
        for (const a of alunos) {
          const unidade = unidadeDestinoDiario(a.turma);
          coletados.push({
            schoolName: unidade,
            className: a.turma,
            name: a.nome,
            sponteId: a.sponteId,
          });
        }
      }
      // Belvedere e Vale do Sereno: token próprio, todos os alunos na sua unidade.
      for (const unidade of ["Núcleo Belvedere", "Núcleo Vale do Sereno"]) {
        const creds = resolverCredenciais(unidade);
        if (!creds) continue;
        const alunos = await listarAlunosAtivos(creds.codigoCliente, creds.token);
        for (const a of alunos) {
          coletados.push({
            schoolName: unidade,
            className: a.turma,
            name: a.nome,
            sponteId: a.sponteId,
          });
        }
      }
    } catch (e) {
      return {
        turmas: 0,
        alunos: 0,
        porUnidade: {},
        error: e instanceof Error ? e.message : "Falha ao consultar o Sponte.",
      };
    }

    // Filtra alunos de unidades que não existem em schools (sem destino válido).
    const validos = coletados.filter((c) => schoolIdByName[c.schoolName]);
    if (validos.length === 0) {
      return { turmas: 0, alunos: 0, porUnidade: {}, indisponivel: true };
    }

    // ── Upsert das turmas (distinct por school_id + nome, ignorando vazios). ──
    const turmaKeys = new Set<string>();
    const turmaRows: { school_id: string; name: string }[] = [];
    for (const c of validos) {
      if (!c.className) continue;
      const schoolId = schoolIdByName[c.schoolName];
      const key = `${schoolId}::${c.className}`;
      if (turmaKeys.has(key)) continue;
      turmaKeys.add(key);
      turmaRows.push({ school_id: schoolId, name: c.className });
    }
    if (turmaRows.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from("diario_classes" as any)
        .upsert(turmaRows, { onConflict: "school_id,name", ignoreDuplicates: true });
      if (upErr) return { turmas: 0, alunos: 0, porUnidade: {}, error: upErr.message };
    }

    // Recarrega as turmas para montar o mapa (school_id, name) → class_id.
    const schoolIds = Array.from(new Set(validos.map((c) => schoolIdByName[c.schoolName])));
    const { data: classRows } = await supabaseAdmin
      .from("diario_classes" as any)
      .select("id, school_id, name")
      .in("school_id", schoolIds);
    const classIdByKey: Record<string, string> = {};
    for (const r of (classRows ?? []) as any[]) {
      classIdByKey[`${r.school_id}::${r.name}`] = r.id as string;
    }

    // ── Upsert dos alunos por (school_id, sponte_aluno_id). NÃO envia `photo`
    // (preserva a foto existente no update). O trigger sincroniza class_name a
    // partir do class_id quando presente. ──
    const studentRows = validos.map((c) => {
      const schoolId = schoolIdByName[c.schoolName];
      const classId = c.className ? (classIdByKey[`${schoolId}::${c.className}`] ?? null) : null;
      porUnidade[c.schoolName] = (porUnidade[c.schoolName] ?? 0) + 1;
      return {
        school_id: schoolId,
        sponte_aluno_id: c.sponteId,
        name: c.name,
        class_id: classId,
        class_name: c.className,
      };
    });

    const { error: stErr } = await supabaseAdmin
      .from("diario_students" as any)
      .upsert(studentRows, { onConflict: "school_id,sponte_aluno_id" });
    if (stErr) return { turmas: turmaRows.length, alunos: 0, porUnidade: {}, error: stErr.message };

    return { turmas: turmaRows.length, alunos: studentRows.length, porUnidade };
  }
}

export const syncDiarioSponte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DiarioSyncResult> => {
    // Somente admin (allowedSponteUnidades retorna null para admin).
    const allowed = await allowedSponteUnidades(context.userId);
    if (allowed !== null) {
      return {
        turmas: 0,
        alunos: 0,
        porUnidade: {},
        error: "Apenas administradores podem sincronizar.",
      };
    }
    return runDiarioSponteSync();
  });
