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

const BATCH_SIZE = 15;

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

  // Batch endpoint — fetches all financial data for a date range in one call
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

        console.log('[Sponte-Batch] Starting:', { dataInicio, dataFim });
        const startTime = Date.now();

        // Step 1: Get all students
        const alunosXml = await callSponte('GetAlunos', 'Nome=');

        const fault = extractFault(alunosXml);
        if (fault) {
          console.error('[Sponte-Batch] GetAlunos fault:', fault);
          res.json({ pendencias: [], error: fault });
          return;
        }

        const alunoNodes = parseXmlList(alunosXml, 'wsAluno');
        const alunos = alunoNodes
          .filter((node) => parseXmlValue(node, 'RetornoOperacao').startsWith('01'))
          .map((node) => ({
            id: parseXmlValue(node, 'AlunoID'),
            nome: parseXmlValue(node, 'Nome'),
          }))
          .filter((a) => a.id && a.id !== '0');

        console.log('[Sponte-Batch] Found', alunos.length, 'students');

        if (alunos.length === 0) {
          res.json({ pendencias: [], error: 'Nenhum aluno encontrado no Sponte.' });
          return;
        }

        // Step 2: Fetch financeiro in parallel batches
        const todasPendencias = [];
        const alunosComPendencia = new Set();

        for (let i = 0; i < alunos.length; i += BATCH_SIZE) {
          const batch = alunos.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map(async (aluno) => {
              const finXml = await callSponte('GetFinanceiro', `AlunoID=${aluno.id}`);
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

        console.log('[Sponte-Batch] Found', todasPendencias.length, 'pending for', alunosComPendencia.size, 'students');

        // Step 3: Fetch responsavel for students with pending items
        const alunoIds = Array.from(alunosComPendencia);
        const responsaveisMap = {};

        for (let i = 0; i < alunoIds.length; i += BATCH_SIZE) {
          const batch = alunoIds.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map(async (alunoId) => {
              const respXml = await callSponte('GetResponsavelFinanceiro', `AlunoID=${alunoId}`);
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

        // Step 4: Enrich with responsavel data
        for (const p of todasPendencias) {
          const resp = responsaveisMap[p.alunoId];
          if (resp) {
            p.nomeResponsavel = resp.nome;
            p.telefone = resp.celular;
          }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('[Sponte-Batch] Complete. Time:', elapsed, 's | Pendencias:', todasPendencias.length);

        res.json({
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
      } catch (err) {
        console.error('[Sponte-Batch] Error:', err.message);
        res.status(500).json({ error: err.message || 'Batch processing error' });
      }
    });
  });
};
