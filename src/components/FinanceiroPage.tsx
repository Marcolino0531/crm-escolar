import React, { useState, useEffect, useCallback } from 'react';
import { Unidade } from '../types';
import { RefreshCw, MessageCircle, AlertTriangle, Search, ChevronDown, ChevronUp } from 'lucide-react';

interface PendenciaFinanceira {
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

interface FinanceiroPageProps {
  unidadeSelecionada: Unidade;
}

function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarTelefoneWhatsApp(telefone: string): string {
  const nums = telefone.replace(/\D/g, '');
  if (nums.startsWith('55')) return nums;
  if (nums.length === 11 || nums.length === 10) return `55${nums}`;
  return `55${nums}`;
}

function gerarLinkWhatsApp(telefone: string, nomeAluno: string, valor: number): string {
  const numero = formatarTelefoneWhatsApp(telefone);
  const valorFormatado = formatarMoeda(valor);
  const mensagem = encodeURIComponent(
    `Olá, aqui é do setor financeiro do colégio. Notamos uma pendência referente ao aluno ${nomeAluno} no valor de ${valorFormatado}. Como podemos ajudar?`
  );
  return `https://wa.me/${numero}?text=${mensagem}`;
}

function parseXmlValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXmlList(xml: string, itemTag: string): string[] {
  const items: string[] = [];
  const regex = new RegExp(`<${itemTag}[^>]*>[\\s\\S]*?</${itemTag}>`, 'gi');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    items.push(match[0]);
  }
  return items;
}

async function callSponteProxy(
  method: string,
  sParametrosBusca?: string
): Promise<{ xml: string; fault?: string }> {
  const proxyUrl = '/api/sponte';

  const body: Record<string, unknown> = { method };
  if (sParametrosBusca) body.sParametrosBusca = sParametrosBusca;

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Proxy error: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  if (data.fault) return { xml: data.xml || '', fault: data.fault };
  return { xml: data.xml || '' };
}

function parseBrDecimal(value: string): number {
  if (!value) return 0;
  return parseFloat(value.replace(/\./g, '').replace(',', '.')) || 0;
}

function filtrarAno2026(vencimento: string): boolean {
  if (!vencimento) return false;
  if (vencimento.includes('/')) {
    const parts = vencimento.split('/');
    const year = parts.length === 3 ? parts[2] : '';
    return year === '2026';
  }
  if (vencimento.includes('-')) {
    return vencimento.startsWith('2026');
  }
  return false;
}

function formatarData(data: string): string {
  if (!data) return '-';
  if (data.includes('/')) return data;
  if (data.includes('-')) {
    const [y, m, d] = data.split('-');
    return `${d}/${m}/${y}`;
  }
  return data;
}

async function fetchAlunos(): Promise<{ id: string; nome: string }[]> {
  const { xml, fault } = await callSponteProxy('GetAlunos', 'Nome=');
  if (fault) throw new Error(`SOAP Fault: ${fault}`);

  const alunoNodes = parseXmlList(xml, 'wsAluno');
  return alunoNodes
    .filter((node) => {
      const ret = parseXmlValue(node, 'RetornoOperacao');
      return ret.startsWith('01');
    })
    .map((node) => ({
      id: parseXmlValue(node, 'AlunoID'),
      nome: parseXmlValue(node, 'Nome'),
    }))
    .filter((a) => a.id && a.id !== '0');
}

async function fetchFinanceiroData(): Promise<{
  pendencias: PendenciaFinanceira[];
  erroApi?: string;
}> {
  let alunos: { id: string; nome: string }[];
  try {
    alunos = await fetchAlunos();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return { pendencias: [], erroApi: msg };
  }

  if (alunos.length === 0) {
    return { pendencias: [], erroApi: 'Nenhum aluno encontrado no Sponte.' };
  }

  const responsaveisCache: Record<string, { nome: string; celular: string }> = {};
  const todasPendencias: PendenciaFinanceira[] = [];

  for (const aluno of alunos) {
    try {
      const { xml: finXml, fault: finFault } = await callSponteProxy(
        'GetFinanceiro',
        `AlunoID=${aluno.id}`
      );

      if (finFault) continue;

      const finRecords = parseXmlList(finXml, 'wsFinanceiro');

      for (const finRecord of finRecords) {
        const retorno = parseXmlValue(finRecord, 'RetornoOperacao');
        if (!retorno.startsWith('01')) continue;

        const alunoNodes = parseXmlList(finRecord, 'wsInfoAluno');
        const nomeAluno = alunoNodes.length > 0
          ? parseXmlValue(alunoNodes[0], 'Nome')
          : aluno.nome;

        const parcelas = parseXmlList(finRecord, 'wsParcela');

        for (const parcela of parcelas) {
          const situacao = parseXmlValue(parcela, 'SituacaoParcela');
          if (situacao === 'Quitada' || situacao === 'Cancelada') continue;

          const vencimento = parseXmlValue(parcela, 'Vencimento');
          if (!filtrarAno2026(vencimento)) continue;

          const valorParcela = parseBrDecimal(parseXmlValue(parcela, 'ValorParcela'));
          const valorPago = parseBrDecimal(parseXmlValue(parcela, 'ValorPago'));
          const saldo = valorParcela - valorPago;

          if (saldo <= 0) continue;

          if (!responsaveisCache[aluno.id]) {
            try {
              const { xml: respXml } = await callSponteProxy(
                'GetResponsavelFinanceiro',
                `AlunoID=${aluno.id}`
              );
              const respNodes = parseXmlList(respXml, 'wsResponsavel');
              if (respNodes.length > 0) {
                const respRetorno = parseXmlValue(respNodes[0], 'RetornoOperacao');
                if (respRetorno.startsWith('01')) {
                  responsaveisCache[aluno.id] = {
                    nome: parseXmlValue(respNodes[0], 'Nome'),
                    celular: parseXmlValue(respNodes[0], 'Celular') || parseXmlValue(respNodes[0], 'Telefone'),
                  };
                }
              }
            } catch {
              // Skip individual responsavel errors
            }
          }

          const resp = responsaveisCache[aluno.id];

          todasPendencias.push({
            alunoId: aluno.id,
            nomeAluno,
            nomeResponsavel: resp?.nome || '-',
            telefone: resp?.celular || '-',
            parcela: parseXmlValue(parcela, 'NumeroParcela') || '1',
            vencimento,
            valor: valorParcela,
            valorPago,
            saldo,
            status: situacao,
          });
        }
      }
    } catch {
      // Skip individual student errors
    }
  }

  return { pendencias: todasPendencias };
}

const FinanceiroPage: React.FC<FinanceiroPageProps> = ({ unidadeSelecionada }) => {
  const [pendencias, setPendencias] = useState<PendenciaFinanceira[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [ordenacao, setOrdenacao] = useState<{ campo: keyof PendenciaFinanceira; direcao: 'asc' | 'desc' }>({
    campo: 'saldo',
    direcao: 'desc',
  });

  const buscarDados = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      const { pendencias: novasPendencias, erroApi } = await fetchFinanceiroData();

      if (erroApi) {
        setErro(erroApi);
        setPendencias([]);
      } else {
        setPendencias(novasPendencias);
      }

      setUltimaAtualizacao(new Date().toLocaleString('pt-BR'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setErro(msg);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    buscarDados();
  }, [buscarDados]);

  const toggleOrdenacao = (campo: keyof PendenciaFinanceira) => {
    setOrdenacao((prev) =>
      prev.campo === campo
        ? { campo, direcao: prev.direcao === 'asc' ? 'desc' : 'asc' }
        : { campo, direcao: 'desc' }
    );
  };

  const pendenciasFiltradas = pendencias
    .filter((p) => {
      if (!filtro) return true;
      const termo = filtro.toLowerCase();
      return (
        p.nomeAluno.toLowerCase().includes(termo) ||
        p.nomeResponsavel.toLowerCase().includes(termo) ||
        p.telefone.includes(termo)
      );
    })
    .sort((a, b) => {
      const dir = ordenacao.direcao === 'asc' ? 1 : -1;
      const valA = a[ordenacao.campo];
      const valB = b[ordenacao.campo];
      if (typeof valA === 'number' && typeof valB === 'number') return (valA - valB) * dir;
      return String(valA).localeCompare(String(valB)) * dir;
    });

  const totalPendente = pendenciasFiltradas.reduce((sum, p) => sum + p.saldo, 0);

  const SortIcon = ({ campo }: { campo: keyof PendenciaFinanceira }) => {
    if (ordenacao.campo !== campo) return <ChevronDown size={14} className="opacity-30" />;
    return ordenacao.direcao === 'asc' ? (
      <ChevronUp size={14} className="text-indigo-600" />
    ) : (
      <ChevronDown size={14} className="text-indigo-600" />
    );
  };

  return (
    <div className="p-6">
      {/* Header with stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 rounded-lg p-2.5">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Pendente (2026)</p>
              <p className="text-xl font-bold text-red-600">{formatarMoeda(totalPendente)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="bg-amber-100 rounded-lg p-2.5">
              <span className="text-xl">&#128104;&#8205;&#128105;&#8205;&#128103;</span>
            </div>
            <div>
              <p className="text-sm text-gray-500">Inadimplentes</p>
              <p className="text-xl font-bold text-amber-600">
                {new Set(pendenciasFiltradas.map((p) => p.alunoId)).size} alunos
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 rounded-lg p-2.5">
              <span className="text-xl">&#128196;</span>
            </div>
            <div>
              <p className="text-sm text-gray-500">Parcelas em Aberto</p>
              <p className="text-xl font-bold text-blue-600">{pendenciasFiltradas.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
          <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Buscar por aluno, responsável ou telefone..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ultimaAtualizacao && (
              <span className="text-xs text-gray-400">Atualizado: {ultimaAtualizacao}</span>
            )}
            <button
              onClick={buscarDados}
              disabled={carregando}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={carregando ? 'animate-spin' : ''} />
              {carregando ? 'Buscando...' : 'Atualizar Dados'}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-red-800 font-medium text-sm">Erro na integração Sponte</p>
            <p className="text-red-600 text-sm mt-1">{erro}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th
                  onClick={() => toggleOrdenacao('nomeAluno')}
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                >
                  <div className="flex items-center gap-1">
                    Aluno <SortIcon campo="nomeAluno" />
                  </div>
                </th>
                <th
                  onClick={() => toggleOrdenacao('nomeResponsavel')}
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                >
                  <div className="flex items-center gap-1">
                    Responsável <SortIcon campo="nomeResponsavel" />
                  </div>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Telefone
                </th>
                <th
                  onClick={() => toggleOrdenacao('vencimento')}
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                >
                  <div className="flex items-center gap-1">
                    Vencimento <SortIcon campo="vencimento" />
                  </div>
                </th>
                <th
                  onClick={() => toggleOrdenacao('saldo')}
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                >
                  <div className="flex items-center gap-1">
                    Valor Pendente <SortIcon campo="saldo" />
                  </div>
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {carregando ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw size={32} className="text-indigo-400 animate-spin" />
                      <p className="text-gray-500 text-sm">Consultando dados do Sponte...</p>
                      <p className="text-gray-400 text-xs">Isso pode levar alguns segundos</p>
                    </div>
                  </td>
                </tr>
              ) : pendenciasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-4xl">
                        {erro ? '&#9888;&#65039;' : '&#127881;'}
                      </span>
                      <p className="text-gray-500 text-sm font-medium">
                        {erro
                          ? 'Não foi possível carregar os dados'
                          : filtro
                          ? 'Nenhum resultado encontrado para o filtro'
                          : 'Nenhuma pendência financeira em 2026'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                pendenciasFiltradas.map((p, idx) => (
                  <tr key={`${p.alunoId}-${p.parcela}-${idx}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{p.nomeAluno}</p>
                      <p className="text-xs text-gray-400">Parcela {p.parcela}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{p.nomeResponsavel}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 font-mono">{p.telefone}</td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-700">{formatarData(p.vencimento)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-bold text-red-600">{formatarMoeda(p.saldo)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {p.telefone && p.telefone !== '-' ? (
                        <a
                          href={gerarLinkWhatsApp(p.telefone, p.nomeAluno, p.saldo)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shadow-sm"
                          title="Enviar cobrança via WhatsApp"
                        >
                          <MessageCircle size={14} />
                          WhatsApp
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">Sem telefone</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pendenciasFiltradas.length > 0 && (
          <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {pendenciasFiltradas.length} parcela{pendenciasFiltradas.length !== 1 ? 's' : ''} pendente{pendenciasFiltradas.length !== 1 ? 's' : ''}
            </span>
            <span className="text-sm font-bold text-red-600">
              Total: {formatarMoeda(totalPendente)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default FinanceiroPage;
