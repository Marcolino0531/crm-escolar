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

function callSponte(method, sParametrosBusca) {
  return new Promise((resolve, reject) => {
    const extraParams = sParametrosBusca
      ? `<sParametrosBusca>${sParametrosBusca}</sParametrosBusca>`
      : '';

    const soapBody = buildSoapEnvelope(method, extraParams);
    const postData = Buffer.from(soapBody, 'utf8');

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
      proxyRes.on('data', (chunk) => { xml += chunk; });
      proxyRes.on('end', () => resolve(xml));
    });

    proxyReq.on('error', reject);
    proxyReq.write(postData);
    proxyReq.end();
  });
}

function parseXmlValue(xml, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXmlList(xml, itemTag) {
  const items = [];
  const regex = new RegExp(`<${itemTag}[^>]*>[\\s\\S]*?</${itemTag}>`, 'gi');
  let m;
  while ((m = regex.exec(xml)) !== null) items.push(m[0]);
  return items;
}

function parseBrDecimal(value) {
  if (!value) return 0;
  return parseFloat(value.replace(/\./g, '').replace(',', '.')) || 0;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr.includes('/')) {
    const [d, m, y] = dateStr.split('/');
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  if (dateStr.includes('-')) return new Date(dateStr);
  return null;
}

function isInDateRange(vencimento, dtInicio, dtFim) {
  const dt = parseDate(vencimento);
  if (!dt) return false;
  return dt >= dtInicio && dt <= dtFim;
}

const BATCH_SIZE = 50;

module.exports = function (app) {
  // Original single-method proxy (kept for backwards compat)
  app.post('/api/sponte', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
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
          proxyRes.on('data', (chunk) => { xml += chunk; });
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

  // Batch endpoint — Query Inversion: fetch debts first, then student data
  app.post('/api/sponte-batch', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { dataInicio, dataFim } = JSON.parse(body);

        if (!dataInicio || !dataFim) {
          res.status(400).json({ error: 'Missing required parameters: dataInicio, dataFim' });
          return;
        }

        const dtInicio = new Date(dataInicio);
        const dtFim = new Date(dataFim);
        dtFim.setHours(23, 59, 59, 999);

        console.log('[Sponte-Batch] Query Inversion — fetching debts first:', { dataInicio, dataFim });
        const startTime = Date.now();

        // Step 1: Fetch ALL open parcels in ONE call (Query Inversion)
        const parcelasXml = await callSponte('GetParcelas', 'Situacao=Aberta');

        const fault = extractFault(parcelasXml);
        if (fault) {
          console.error('[Sponte-Batch] GetParcelas fault:', fault);
          res.json({ pendencias: [], error: fault });
          return;
        }

        const t1 = Date.now();
        console.log('[Sponte-Batch] GetParcelas completed in', ((t1 - startTime) / 1000).toFixed(1), 's');

        const parcelaNodes = parseXmlList(parcelasXml, 'wsParcela');

        // Step 2: Filter by date range and build pendencias
        const todasPendencias = [];
        const alunosComPendencia = new Set();

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
          res.json({
            pendencias: [],
            meta: { totalAlunos: 0, alunosComPendencia: 0, totalParcelas: 0, tempoSegundos: parseFloat(elapsed), dataInicio, dataFim },
          });
          return;
        }

        // Step 3: Fetch student names + responsavel ONLY for debtors
        const debtorIds = Array.from(alunosComPendencia);
        const alunoNomeMap = {};
        const responsaveisMap = {};

        for (let i = 0; i < debtorIds.length; i += BATCH_SIZE) {
          const batch = debtorIds.slice(i, i + BATCH_SIZE);

          const [alunoResults, respResults] = await Promise.all([
            Promise.allSettled(
              batch.map(async (id) => {
                const xml = await callSponte('GetAlunos', `AlunoID=${id}`);
                return { id, xml };
              })
            ),
            Promise.allSettled(
              batch.map(async (id) => {
                const xml = await callSponte('GetResponsavelFinanceiro', `AlunoID=${id}`);
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

        // Step 4: Enrich pendencias with student names + responsavel
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

        res.json({
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
      } catch (err) {
        console.error('[Sponte-Batch] Error:', err.message);
        res.status(500).json({ error: err.message || 'Batch processing error' });
      }
    });
  });
};
