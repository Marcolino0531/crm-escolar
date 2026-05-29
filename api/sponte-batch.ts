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

const BATCH_SIZE = 15;

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

  console.log('[Sponte-Batch] Starting batch fetch:', { dataInicio, dataFim });
  const startTime = Date.now();

  try {
    // Step 1: Get all students
    const alunosXml = await callSponte('GetAlunos', 'Nome=', codigoCliente, token);

    const faultCode = alunosXml.match(/<faultcode>([^<]*)<\/faultcode>/i)?.[1];
    const faultString = alunosXml.match(/<faultstring>([^<]*)<\/faultstring>/i)?.[1];
    if (faultCode || faultString) {
      console.error('[Sponte-Batch] GetAlunos SOAP Fault:', { faultCode, faultString });
      return res.status(200).json({ pendencias: [], error: faultString || `Fault: ${faultCode}` });
    }

    const alunoNodes = parseXmlList(alunosXml, 'wsAluno');
    const alunos = alunoNodes
      .filter((node) => parseXmlValue(node, 'RetornoOperacao').startsWith('01'))
      .map((node) => ({
        id: parseXmlValue(node, 'AlunoID'),
        nome: parseXmlValue(node, 'Nome'),
      }))
      .filter((a) => a.id && a.id !== '0');

    console.log('[Sponte-Batch] Found', alunos.length, 'students. Processing in batches of', BATCH_SIZE);

    if (alunos.length === 0) {
      return res.status(200).json({ pendencias: [], error: 'Nenhum aluno encontrado no Sponte.' });
    }

    // Step 2: Fetch financeiro data in parallel batches
    const todasPendencias: Pendencia[] = [];
    const alunosComPendencia = new Set<string>();

    for (let i = 0; i < alunos.length; i += BATCH_SIZE) {
      const batch = alunos.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (aluno) => {
          const finXml = await callSponte('GetFinanceiro', `AlunoID=${aluno.id}`, codigoCliente, token);
          return { aluno, finXml };
        })
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { aluno, finXml } = result.value;

        const finRecords = parseXmlList(finXml, 'wsFinanceiro');
        for (const finRecord of finRecords) {
          const retorno = parseXmlValue(finRecord, 'RetornoOperacao');
          if (!retorno.startsWith('01')) continue;

          const alunoInfoNodes = parseXmlList(finRecord, 'wsInfoAluno');
          const nomeAluno = alunoInfoNodes.length > 0
            ? parseXmlValue(alunoInfoNodes[0], 'Nome')
            : aluno.nome;

          const parcelas = parseXmlList(finRecord, 'wsParcela');
          for (const parcela of parcelas) {
            const situacao = parseXmlValue(parcela, 'SituacaoParcela');
            if (situacao === 'Quitada' || situacao === 'Cancelada') continue;

            const vencimento = parseXmlValue(parcela, 'Vencimento');
            if (!isInDateRange(vencimento, dtInicio, dtFim)) continue;

            const valorParcela = parseBrDecimal(parseXmlValue(parcela, 'ValorParcela'));
            const valorPago = parseBrDecimal(parseXmlValue(parcela, 'ValorPago'));
            const saldo = valorParcela - valorPago;
            if (saldo <= 0) continue;

            alunosComPendencia.add(aluno.id);
            todasPendencias.push({
              alunoId: aluno.id,
              nomeAluno,
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
        }
      }
    }

    console.log('[Sponte-Batch] Found', todasPendencias.length, 'pending items for', alunosComPendencia.size, 'students');

    // Step 3: Fetch responsavel data only for students with pending items (parallel)
    const alunoIds = Array.from(alunosComPendencia);
    const responsaveisMap: Record<string, { nome: string; celular: string }> = {};

    for (let i = 0; i < alunoIds.length; i += BATCH_SIZE) {
      const batch = alunoIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (alunoId) => {
          const respXml = await callSponte('GetResponsavelFinanceiro', `AlunoID=${alunoId}`, codigoCliente, token);
          return { alunoId, respXml };
        })
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { alunoId, respXml } = result.value;

        const respNodes = parseXmlList(respXml, 'wsResponsavel');
        if (respNodes.length > 0) {
          const respRetorno = parseXmlValue(respNodes[0], 'RetornoOperacao');
          if (respRetorno.startsWith('01')) {
            responsaveisMap[alunoId] = {
              nome: parseXmlValue(respNodes[0], 'Nome'),
              celular: parseXmlValue(respNodes[0], 'Celular') || parseXmlValue(respNodes[0], 'Telefone'),
            };
          }
        }
      }
    }

    // Step 4: Enrich pendencias with responsavel data
    for (const p of todasPendencias) {
      const resp = responsaveisMap[p.alunoId];
      if (resp) {
        p.nomeResponsavel = resp.nome;
        p.telefone = resp.celular;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('[Sponte-Batch] Complete. Time:', elapsed, 's | Pendencias:', todasPendencias.length);

    return res.status(200).json({
      pendencias: todasPendencias,
      meta: {
        totalAlunos: alunos.length,
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
