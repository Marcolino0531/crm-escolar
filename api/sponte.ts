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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const codigoCliente = process.env.SPONTE_CODIGO_CLIENTE;
  const token = process.env.SPONTE_TOKEN;

  if (!codigoCliente || !token) {
    return res.status(500).json({
      error: 'Chaves da API do Sponte não configuradas no servidor. Configure as variáveis SPONTE_CODIGO_CLIENTE e SPONTE_TOKEN.',
    });
  }

  const { method, sParametrosBusca } = req.body;

  if (!method) {
    return res.status(400).json({ error: 'Missing required parameter: method' });
  }

  const extraParams = sParametrosBusca
    ? `<sParametrosBusca>${sParametrosBusca}</sParametrosBusca>`
    : '';

  const soapBody = buildSoapEnvelope(method, extraParams, codigoCliente, token);

  console.log('[Sponte] Request:', { method, sParametrosBusca, codigoCliente: codigoCliente ? '***' : 'MISSING', token: token ? '***' : 'MISSING' });

  try {
    const response = await fetch(SPONTE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `${SPONTE_NS}${method}`,
      },
      body: soapBody,
    });

    const xml = await response.text();

    console.log('[Sponte] HTTP Status:', response.status, '| Response length:', xml.length);

    if (!response.ok) {
      console.error('[Sponte] HTTP error. Status:', response.status, '| Raw response (first 500 chars):', xml.substring(0, 500));
      return res.status(502).json({
        error: `Sponte retornou HTTP ${response.status}. Verifique as credenciais e o endpoint.`,
        detail: xml.substring(0, 500),
      });
    }

    const faultCode = xml.match(/<faultcode>([^<]*)<\/faultcode>/i)?.[1] || null;
    const faultString = xml.match(/<faultstring>([^<]*)<\/faultstring>/i)?.[1] || null;

    if (faultCode || faultString) {
      console.error('[Sponte] SOAP Fault detected:', { faultCode, faultString });
      console.error('[Sponte] Raw SOAP fault response (first 1000 chars):', xml.substring(0, 1000));
      return res.status(200).json({
        xml,
        status: response.status,
        fault: faultString || `Fault: ${faultCode}`,
        faultCode,
        faultString,
      });
    }

    return res.status(200).json({ xml, status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[Sponte] Network/fetch error:', {
      message,
      stack,
      name: error instanceof Error ? error.name : typeof error,
      url: SPONTE_URL,
      method,
    });
    return res.status(500).json({
      error: `Erro de conexão com o Sponte: ${message}`,
      detail: stack,
    });
  }
}
