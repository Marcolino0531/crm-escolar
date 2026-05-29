const https = require('https');

const SPONTE_HOSTNAME = 'api.sponteeducacional.net.br';
const SPONTE_PATH = '/WSAPIEdu.asmx';
const SPONTE_NS = 'http://api.sponteeducacional.net.br/';
const CODIGO_CLIENTE = process.env.SPONTE_CODIGO_CLIENTE || '23568';
const TOKEN = process.env.SPONTE_TOKEN || 'IRAuaZf735NX';

function buildSoapEnvelope(method, extraParams) {
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

function extractFault(xml) {
  const faultStringMatch = xml.match(/<faultstring>([^<]*)<\/faultstring>/i);
  if (faultStringMatch) return faultStringMatch[1];
  const faultMatch = xml.match(/<faultcode>([^<]*)<\/faultcode>/i);
  if (faultMatch) return `Fault: ${faultMatch[1]}`;
  return null;
}

module.exports = function (app) {
  app.post('/api/sponte', (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { method, sParametrosBusca } = JSON.parse(body);

        if (!method) {
          res.status(400).json({ error: 'Missing required parameter: method' });
          return;
        }

        const extraParams = sParametrosBusca
          ? `<sParametrosBusca>${sParametrosBusca}</sParametrosBusca>`
          : '';

        const soapBody = buildSoapEnvelope(method, extraParams);
        const postData = Buffer.from(soapBody, 'utf8');

        console.log('[Sponte] Request:', { method, sParametrosBusca });

        const options = {
          hostname: SPONTE_HOSTNAME,
          port: 443,
          path: SPONTE_PATH,
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Content-Length': postData.length,
            SOAPAction: `${SPONTE_NS}${method}`,
          },
        };

        const proxyReq = https.request(options, (proxyRes) => {
          let xml = '';
          proxyRes.on('data', (chunk) => {
            xml += chunk;
          });
          proxyRes.on('end', () => {
            console.log('[Sponte] Status:', proxyRes.statusCode, '| Response length:', xml.length);

            const fault = extractFault(xml);
            if (fault) {
              console.error('[Sponte] SOAP Fault:', fault);
              res.json({ xml, status: proxyRes.statusCode, fault });
            } else {
              res.json({ xml, status: proxyRes.statusCode });
            }
          });
        });

        proxyReq.on('error', (err) => {
          console.error('[Sponte] Network error:', err.message);
          res.status(500).json({ error: err.message });
        });

        proxyReq.write(postData);
        proxyReq.end();
      } catch (err) {
        console.error('[Sponte] Parse error:', err.message);
        res.status(500).json({ error: err.message || 'Parse error' });
      }
    });
  });
};
