import type { VercelRequest, VercelResponse } from '@vercel/node';

const SPONTE_URL = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx';
const SPONTE_NS = 'http://api.sponteeducacional.net.br/';
const CODIGO_CLIENTE = 23568;
const TOKEN = 'IRAuaZf735NX';

function buildSoapEnvelope(method: string, extraParams: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${SPONTE_NS}">
      <nCodigoCliente>${CODIGO_CLIENTE}</nCodigoCliente>
      <sToken>${TOKEN}</sToken>
      ${extraParams}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
}

function extractFault(xml: string): string | null {
  const faultStringMatch = xml.match(/<faultstring>([^<]*)<\/faultstring>/i);
  if (faultStringMatch) return faultStringMatch[1];
  const faultMatch = xml.match(/<faultcode>([^<]*)<\/faultcode>/i);
  if (faultMatch) return `Fault: ${faultMatch[1]}`;
  return null;
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

  const { method, sParametrosBusca } = req.body;

  if (!method) {
    return res.status(400).json({ error: 'Missing required parameter: method' });
  }

  const extraParams = sParametrosBusca
    ? `<sParametrosBusca>${sParametrosBusca}</sParametrosBusca>`
    : '';

  const soapBody = buildSoapEnvelope(method, extraParams);

  console.log('[Sponte] Request:', { method, sParametrosBusca });

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

    console.log('[Sponte] Status:', response.status, '| Response length:', xml.length);

    const fault = extractFault(xml);
    if (fault) {
      console.error('[Sponte] SOAP Fault:', fault);
      return res.status(200).json({ xml, status: response.status, fault });
    }

    return res.status(200).json({ xml, status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sponte] Network error:', message);
    return res.status(500).json({ error: message });
  }
}
