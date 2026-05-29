import type { VercelRequest, VercelResponse } from '@vercel/node';

const SPONTE_URL = 'https://webservices.sponteweb.com.br/WSPortalAluno/WSPortalAluno.asmx';
const SPONTE_NS = 'http://www.sponteweb.net.br/';

function buildSoapEnvelope(method: string, params: Record<string, string>): string {
  const paramsXml = Object.entries(params)
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${SPONTE_NS}">
      ${paramsXml}
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

  const { method, sSenha, nCodCliSponte, nAlunoID } = req.body;

  if (!method || !sSenha || nCodCliSponte === undefined) {
    return res.status(400).json({ error: 'Missing required parameters: method, sSenha, nCodCliSponte' });
  }

  const params: Record<string, string> = {
    sSenha,
    nCodCliSponte: String(nCodCliSponte),
  };

  if (nAlunoID !== undefined) {
    params.nAlunoID = String(nAlunoID);
  }

  const soapBody = buildSoapEnvelope(method, params);

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
    return res.status(200).json({ xml, status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
