const https = require('https');

const SPONTE_URL = 'https://webservices.sponteweb.com.br';
const SPONTE_NS = 'http://www.sponteweb.net.br/';

function buildSoapEnvelope(method, params) {
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

module.exports = function (app) {
  app.post('/api/sponte', (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { method, sSenha, nCodCliSponte, nAlunoID } = JSON.parse(body);

        if (!method || !sSenha || nCodCliSponte === undefined) {
          res.status(400).json({ error: 'Missing required parameters' });
          return;
        }

        const params = { sSenha, nCodCliSponte: String(nCodCliSponte) };
        if (nAlunoID !== undefined) params.nAlunoID = String(nAlunoID);

        const soapBody = buildSoapEnvelope(method, params);
        const postData = Buffer.from(soapBody, 'utf8');

        const options = {
          hostname: 'webservices.sponteweb.com.br',
          port: 443,
          path: '/WSPortalAluno/WSPortalAluno.asmx',
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
            res.json({ xml, status: proxyRes.statusCode });
          });
        });

        proxyReq.on('error', (err) => {
          res.status(500).json({ error: err.message });
        });

        proxyReq.write(postData);
        proxyReq.end();
      } catch (err) {
        res.status(500).json({ error: err.message || 'Parse error' });
      }
    });
  });
};
