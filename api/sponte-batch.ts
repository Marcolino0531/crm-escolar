import type { VercelRequest, VercelResponse } from '@vercel/node';

const SPONTE_URL = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx';
const SPONTE_NS = 'http://api.sponteeducacional.net.br/';

function buildSoapEnvelope(method: string, extraParams: string, codigoCliente: string, token: string): string {
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
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXmlList(xml: string, itemTag: string): string[] {
  const items: string[] = [];
  const regex = new RegExp(`<${itemTag}[^>]*>[\\s\\S]*?</${itemTag}>`, 'gi');
  let m;
  while ((m = regex.exec(xml)) !== null) {
    items.push(m[0]);
  }
  return items;
}

function parseBrDecimal(value: string): number {
  if (!value) return 0;
  return parseFloat(value.replace(/\./g, '').replace(',', '.')) || 0;
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  if (dateStr.includes('/')) {
    const [d, m, y] = dateStr.split('/');
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  if (dateStr.includes('-')) {
    return new Date(dateStr);
  }
  return null;
}

function isInDateRange(vencimento: string, dataInicio: Date, dataFim: Date): boolean {
  const dt = parseDate(vencimento);
  if (!dt) return false;
  return dt >= dataInicio && dt <= dataFim;
}

async function callSponte(method: string, sParametrosBusca: string, codigoCliente: string, token: string): Promise<string> {
  const extraParams = sParametrosBusca
    ? `<sParametrosBusca>${sParametrosBusca}</sParametrosBusca>`
    : '';
  const soapBody = buildSoapEnvelope(method, extraParams, codigoCliente, token);

  const response = await fetch(SPONTE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
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

interface Pendencia {
  alunoId: string;
  nomeAluno: string;
  nomeResponsavel: string;
  telefone: string;
  parcela: string;
  vencimento: string;
  valor: number;
  valorPago: number;
  saldo: number;
  status: string;
}

const BATCH_SIZE = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const codigoCliente = process.env.SPONTE_CODIGO_CLIENTE;
  const token = process.env.SPONTE_TOKEN;
  if (!codigoCliente || !token) {
    return res.status(500).json({
      error: 'Chaves da API do Sponte não configuradas no servidor. Configure as variáveis SPONTE_CODIGO_CLIENTE e SPONTE_TOKEN.',
    });
  }

  const { dataInicio, dataFim } = req.body;
  if (!dataInicio || !dataFim) {
    return res.status(400).json({ error: 'Missing required parameters: dataInicio, dataFim (YYYY-MM-DD)' });
  }

  const dtInicio = new Date(dataInicio);
  const dtFim = new Date(dataFim);
  dtFim.setHours(23, 59, 59, 999);

  console.log('[Sponte-Batch] Query Inversion — fetching debts first:', { dataInicio, dataFim });
  const startTime = Date.now();

  try {
    // ── Step 1: Fetch ALL open parcels in ONE call (Query Inversion) ──
    const parcelasXml = await callSponte('GetParcelas', 'Situacao=Aberta', codigoCliente, token);

    const fault = checkFault(parcelasXml);
    if (fault) {
      console.error('[Sponte-Batch] GetParcelas SOAP Fault:', fault);
      return res.status(200).json({ pendencias: [], error: fault });
    }

    const t1 = Date.now();
    console.log('[Sponte-Batch] GetParcelas completed in', ((t1 - startTime) / 1000).toFixed(1), 's');

    const parcelaNodes = parseXmlList(parcelasXml, 'wsParcela');

    // ── Step 2: Filter by date range and build pendencias ──
    const todasPendencias: Pendencia[] = [];
    const alunosComPendencia = new Set<string>();

    for (const parcela of parcelaNodes) {
      const retorno = parseXmlValue(parcela, 'RetornoOperacao');
      if (!retorno.startsWith('01')) continue;

      const situacao = parseXmlValue(parcela, 'SituacaoParcela');
      if (situacao === 'Quitada' || situacao === 'Cancelada') continue;

      const vencimento = parseXmlValue(parcela, 'Vencimento');
      if (!isInDateRange(vencimento, dtInicio, dtFim)) continue;

      const valorParcela = parseBrDecimal(parseXmlValue(parcela, 'ValorParcela'));
      const valorPago = parseBrDecimal(parseXmlValue(parcela, 'ValorPago'));
      const saldo = valorParcela - valorPago;
      if (saldo <= 0) continue;

      const alunoId = parseXmlValue(parcela, 'AlunoID');
      if (!alunoId || alunoId === '0') continue;

      alunosComPendencia.add(alunoId);
      todasPendencias.push({
        alunoId,
        nomeAluno: parseXmlValue(parcela, 'Sacado') || '-',
        nomeResponsavel: '-',
        telefone: '-',
        parcela: parseXmlValue(parcela, 'NumeroParcela') || '1',
        vencimento,
        valor: valorParcela,
        valorPago,
        saldo,
        status: situacao,
      });
    }

    console.log('[Sponte-Batch] Filtered:', todasPendencias.length, 'parcelas for', alunosComPendencia.size, 'debtors (from', parcelaNodes.length, 'total open parcels)');

    if (todasPendencias.length === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      return res.status(200).json({
        pendencias: [],
        meta: { totalAlunos: 0, alunosComPendencia: 0, totalParcelas: 0, tempoSegundos: parseFloat(elapsed), dataInicio, dataFim },
      });
    }

    // ── Step 3: Fetch student names + responsável data ONLY for debtors ──
    const debtorIds = Array.from(alunosComPendencia);
    const alunoNomeMap: Record<string, string> = {};
    const responsaveisMap: Record<string, { nome: string; celular: string }> = {};

    for (let i = 0; i < debtorIds.length; i += BATCH_SIZE) {
      const batch = debtorIds.slice(i, i + BATCH_SIZE);

      const [alunoResults, respResults] = await Promise.all([
        Promise.allSettled(
          batch.map(async (id) => {
            const xml = await callSponte('GetAlunos', `AlunoID=${id}`, codigoCliente, token);
            return { id, xml };
          })
        ),
        Promise.allSettled(
          batch.map(async (id) => {
            const xml = await callSponte('GetResponsavelFinanceiro', `AlunoID=${id}`, codigoCliente, token);
            return { id, xml };
          })
        ),
      ]);

      for (const result of alunoResults) {
        if (result.status !== 'fulfilled') continue;
        const { id, xml } = result.value;
        const nodes = parseXmlList(xml, 'wsAluno');
        if (nodes.length > 0 && parseXmlValue(nodes[0], 'RetornoOperacao').startsWith('01')) {
          alunoNomeMap[id] = parseXmlValue(nodes[0], 'Nome');
        }
      }

      for (const result of respResults) {
        if (result.status !== 'fulfilled') continue;
        const { id, xml } = result.value;
        const nodes = parseXmlList(xml, 'wsResponsavel');
        if (nodes.length > 0 && parseXmlValue(nodes[0], 'RetornoOperacao').startsWith('01')) {
          responsaveisMap[id] = {
            nome: parseXmlValue(nodes[0], 'Nome'),
            celular: parseXmlValue(nodes[0], 'Celular') || parseXmlValue(nodes[0], 'Telefone'),
          };
        }
      }
    }

    // ── Step 4: Enrich pendencias with student names + responsável ──
    for (const p of todasPendencias) {
      if (alunoNomeMap[p.alunoId]) {
        p.nomeAluno = alunoNomeMap[p.alunoId];
      }
      const resp = responsaveisMap[p.alunoId];
      if (resp) {
        p.nomeResponsavel = resp.nome;
        p.telefone = resp.celular;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('[Sponte-Batch] Complete. Time:', elapsed, 's | Pendencias:', todasPendencias.length, '| Debtors:', debtorIds.length);

    return res.status(200).json({
      pendencias: todasPendencias,
      meta: {
        totalAlunos: debtorIds.length,
        alunosComPendencia: alunosComPendencia.size,
        totalParcelas: todasPendencias.length,
        tempoSegundos: parseFloat(elapsed),
        dataInicio,
        dataFim,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[Sponte-Batch] Error:', { message, stack });
    return res.status(500).json({
      error: `Erro ao buscar dados financeiros: ${message}`,
      detail: stack,
    });
  }
}
