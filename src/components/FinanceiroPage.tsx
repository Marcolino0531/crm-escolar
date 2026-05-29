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

const SPONTE_CONFIG_KEY = 'schooler-hub-sponte-config';

function carregarConfigSponte(): { sSenha: string; nCodCliSponte: string } {
  try {
    const saved = localStorage.getItem(SPONTE_CONFIG_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { sSenha: '', nCodCliSponte: '' };
}

function salvarConfigSponte(config: { sSenha: string; nCodCliSponte: string }) {
  localStorage.setItem(SPONTE_CONFIG_KEY, JSON.stringify(config));
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
  const regex = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)</${itemTag}>`, 'gi');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    items.push(match[0]);
  }
  return items;
}

function parseSoapResponse(xml: string, resultTag: string): string {
  const regex = new RegExp(`<${resultTag}>([\\s\\S]*?)</${resultTag}>`, 'i');
  const match = xml.match(regex);
  if (!match) return '';
  let inner = match[1];
  if (inner.startsWith('&lt;')) {
    inner = inner
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');
  }
  return inner;
}

async function callSponteProxy(
  method: string,
  sSenha: string,
  nCodCliSponte: string,
  nAlunoID?: number
): Promise<string> {
  const proxyUrl = '/api/sponte';

  const body: Record<string, unknown> = { method, sSenha, nCodCliSponte: Number(nCodCliSponte) };
  if (nAlunoID !== undefined) body.nAlunoID = nAlunoID;

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`Proxy error: ${response.status}`);
  const data = await response.json();

  if (data.error) throw new Error(data.error);
  return data.xml || '';
}

async function fetchAlunos(sSenha: string, nCodCliSponte: string): Promise<{ id: string; nome: string }[]> {
  const xml = await callSponteProxy('RetListaAlunos', sSenha, nCodCliSponte);
  const inner = parseSoapResponse(xml, 'RetListaAlunosResult');

  if (inner.includes('<erro>')) {
    const erro = parseXmlValue(inner, 'erro');
    throw new Error(`Sponte erro ${erro}: Verifique sSenha e nCodCliSponte`);
  }

  const alunoNodes = parseXmlList(inner, 'Aluno');
  return alunoNodes.map((node) => ({
    id: parseXmlValue(node, 'AlunoID') || parseXmlValue(node, 'ID'),
    nome: parseXmlValue(node, 'Nome') || parseXmlValue(node, 'NomeAluno'),
  })).filter((a) => a.id);
}

async function fetchDadosAluno(
  sSenha: string,
  nCodCliSponte: string,
  alunoId: number
): Promise<{ nome: string; email: string; responsavel: string; telefone: string }> {
  const xml = await callSponteProxy('RetDadosAluno', sSenha, nCodCliSponte, alunoId);
  const inner = parseSoapResponse(xml, 'RetDadosAlunoResult');

  return {
    nome: parseXmlValue(inner, 'Nome') || parseXmlValue(inner, 'NomeAluno') || '',
    email: parseXmlValue(inner, 'Email') || '',
    responsavel:
      parseXmlValue(inner, 'NomeResponsavel') ||
      parseXmlValue(inner, 'Responsavel') ||
      parseXmlValue(inner, 'NomePaiMae') ||
      '',
    telefone:
      parseXmlValue(inner, 'Celular') ||
      parseXmlValue(inner, 'Telefone') ||
      parseXmlValue(inner, 'TelefoneResponsavel') ||
      '',
  };
}

async function fetchFinanceiro(
  sSenha: string,
  nCodCliSponte: string,
  alunoId: number
): Promise<
  {
    parcela: string;
    vencimento: string;
    valor: number;
    valorPago: number;
    saldo: number;
    status: string;
  }[]
> {
  const xml = await callSponteProxy('RetHistoricoFinanceiro', sSenha, nCodCliSponte, alunoId);
  const inner = parseSoapResponse(xml, 'RetHistoricoFinanceiroResult');

  if (!inner || inner.includes('<erro>')) return [];

  const parcelaNodes = parseXmlList(inner, 'Parcela');
  if (parcelaNodes.length === 0) {
    const contaNodes = parseXmlList(inner, 'Conta');
    return contaNodes.map((node) => ({
      parcela: parseXmlValue(node, 'Descricao') || parseXmlValue(node, 'NumeroParcela') || '1',
      vencimento: parseXmlValue(node, 'DataVencimento') || parseXmlValue(node, 'Vencimento') || '',
      valor: parseFloat(parseXmlValue(node, 'Valor') || '0'),
      valorPago: parseFloat(parseXmlValue(node, 'ValorPago') || '0'),
      saldo: parseFloat(parseXmlValue(node, 'Saldo') || parseXmlValue(node, 'ValorAberto') || '0'),
      status: parseXmlValue(node, 'Situacao') || parseXmlValue(node, 'Status') || '',
    }));
  }

  return parcelaNodes.map((node) => ({
    parcela: parseXmlValue(node, 'Descricao') || parseXmlValue(node, 'NumeroParcela') || '1',
    vencimento: parseXmlValue(node, 'DataVencimento') || parseXmlValue(node, 'Vencimento') || '',
    valor: parseFloat(parseXmlValue(node, 'Valor') || '0'),
    valorPago: parseFloat(parseXmlValue(node, 'ValorPago') || '0'),
    saldo: parseFloat(parseXmlValue(node, 'Saldo') || parseXmlValue(node, 'ValorAberto') || '0'),
    status: parseXmlValue(node, 'Situacao') || parseXmlValue(node, 'Status') || '',
  }));
}

function filtrarAno2026(vencimento: string): boolean {
  if (!vencimento) return false;
  // Accept formats: YYYY-MM-DD, DD/MM/YYYY, YYYY
  if (vencimento.includes('-')) {
    return vencimento.startsWith('2026');
  }
  if (vencimento.includes('/')) {
    const parts = vencimento.split('/');
    const year = parts.length === 3 ? parts[2] : '';
    return year === '2026';
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

const FinanceiroPage: React.FC<FinanceiroPageProps> = ({ unidadeSelecionada }) => {
  const [config, setConfig] = useState(carregarConfigSponte);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [tempConfig, setTempConfig] = useState(config);

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
    if (!config.sSenha || !config.nCodCliSponte) {
      setErro('Configure o Token e o Código do Cliente Sponte antes de buscar dados.');
      setConfigModalOpen(true);
      return;
    }

    setCarregando(true);
    setErro(null);

    try {
      const alunos = await fetchAlunos(config.sSenha, config.nCodCliSponte);

      if (alunos.length === 0) {
        setErro('Nenhum aluno encontrado. Verifique as credenciais do Sponte.');
        setCarregando(false);
        return;
      }

      const todasPendencias: PendenciaFinanceira[] = [];

      for (const aluno of alunos) {
        try {
          const [dados, parcelas] = await Promise.all([
            fetchDadosAluno(config.sSenha, config.nCodCliSponte, Number(aluno.id)),
            fetchFinanceiro(config.sSenha, config.nCodCliSponte, Number(aluno.id)),
          ]);

          const pendentes = parcelas
            .filter((p) => filtrarAno2026(p.vencimento))
            .filter((p) => {
              const saldo = p.saldo || p.valor - p.valorPago;
              return saldo > 0;
            });

          for (const p of pendentes) {
            todasPendencias.push({
              alunoId: aluno.id,
              nomeAluno: dados.nome || aluno.nome,
              nomeResponsavel: dados.responsavel || '-',
              telefone: dados.telefone || '-',
              parcela: p.parcela,
              vencimento: p.vencimento,
              valor: p.valor,
              valorPago: p.valorPago,
              saldo: p.saldo || p.valor - p.valorPago,
              status: p.status,
            });
          }
        } catch {
          // Skip individual student errors
        }
      }

      setPendencias(todasPendencias);
      setUltimaAtualizacao(new Date().toLocaleString('pt-BR'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setErro(msg);
    } finally {
      setCarregando(false);
    }
  }, [config]);

  useEffect(() => {
    if (config.sSenha && config.nCodCliSponte) {
      buscarDados();
    }
  }, [config, buscarDados]);

  const salvarConfig = () => {
    setConfig(tempConfig);
    salvarConfigSponte(tempConfig);
    setConfigModalOpen(false);
  };

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
              <span className="text-xl">👨‍👩‍👧</span>
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
              <span className="text-xl">📄</span>
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
            <button
              onClick={() => {
                setTempConfig(config);
                setConfigModalOpen(true);
              }}
              className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              ⚙️ Configurar API
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-red-800 font-medium text-sm">Erro na integração</p>
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
                        {!config.sSenha || !config.nCodCliSponte ? '🔑' : '🎉'}
                      </span>
                      <p className="text-gray-500 text-sm font-medium">
                        {!config.sSenha || !config.nCodCliSponte
                          ? 'Configure as credenciais do Sponte para começar'
                          : filtro
                          ? 'Nenhum resultado encontrado para o filtro'
                          : 'Nenhuma pendência financeira em 2026'}
                      </p>
                      {(!config.sSenha || !config.nCodCliSponte) && (
                        <button
                          onClick={() => {
                            setTempConfig(config);
                            setConfigModalOpen(true);
                          }}
                          className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium"
                        >
                          Clique aqui para configurar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                pendenciasFiltradas.map((p, idx) => (
                  <tr key={`${p.alunoId}-${p.parcela}-${idx}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{p.nomeAluno}</p>
                      <p className="text-xs text-gray-400">{p.parcela}</p>
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

      {/* Config Modal */}
      {configModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-t-2xl px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🔑</span>
                  <h2 className="text-white text-lg font-bold">Configurar Sponte</h2>
                </div>
                <button
                  onClick={() => setConfigModalOpen(false)}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Token (sSenha) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={tempConfig.sSenha}
                  onChange={(e) => setTempConfig((prev) => ({ ...prev, sSenha: e.target.value }))}
                  placeholder="Ex: IRAuaZf735NX"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">Senha/Token de autenticação da API SOAP do Sponte</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Código do Cliente (nCodCliSponte) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={tempConfig.nCodCliSponte}
                  onChange={(e) =>
                    setTempConfig((prev) => ({
                      ...prev,
                      nCodCliSponte: e.target.value.replace(/\D/g, ''),
                    }))
                  }
                  placeholder="Ex: 3751"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Encontre nas configurações de integração do Sponte
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setConfigModalOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  onClick={salvarConfig}
                  disabled={!tempConfig.sSenha.trim() || !tempConfig.nCodCliSponte.trim()}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 text-sm font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Salvar e Buscar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinanceiroPage;
