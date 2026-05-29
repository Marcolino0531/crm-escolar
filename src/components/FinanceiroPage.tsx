import React, { useState, useEffect, useCallback } from 'react';
import { Unidade } from '../types';
import { RefreshCw, MessageCircle, AlertTriangle, Search, ChevronDown, ChevronUp, PartyPopper, SearchX, Users, FileText, Calendar, Clock } from 'lucide-react';

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

interface BatchMeta {
  totalAlunos: number;
  alunosComPendencia: number;
  totalParcelas: number;
  tempoSegundos: number;
  dataInicio: string;
  dataFim: string;
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

function formatarData(data: string): string {
  if (!data) return '-';
  if (data.includes('/')) return data;
  if (data.includes('-')) {
    const [y, m, d] = data.split('-');
    return `${d}/${m}/${y}`;
  }
  return data;
}

function getDefaultDateRange(): { inicio: string; fim: string } {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - 30);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { inicio: fmt(inicio), fim: fmt(hoje) };
}

function formatDateBR(isoDate: string): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function calcDiffDays(inicio: string, fim: string): number {
  const d1 = new Date(inicio);
  const d2 = new Date(fim);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function getPeriodoLabel(inicio: string, fim: string): string {
  const hoje = new Date().toISOString().split('T')[0];
  const diff = calcDiffDays(inicio, fim);

  if (fim === hoje && diff === 30) return 'Últimos 30 dias';
  if (fim === hoje && diff === 60) return 'Últimos 60 dias';
  if (fim === hoje && diff === 90) return 'Últimos 90 dias';
  return `${formatDateBR(inicio)} — ${formatDateBR(fim)} (${diff} dias)`;
}

const FinanceiroPage: React.FC<FinanceiroPageProps> = ({ unidadeSelecionada }) => {
  const defaultRange = getDefaultDateRange();
  const [pendencias, setPendencias] = useState<PendenciaFinanceira[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [meta, setMeta] = useState<BatchMeta | null>(null);
  const [ordenacao, setOrdenacao] = useState<{ campo: keyof PendenciaFinanceira; direcao: 'asc' | 'desc' }>({
    campo: 'saldo',
    direcao: 'desc',
  });

  // Date range state
  const [dataInicio, setDataInicio] = useState(defaultRange.inicio);
  const [dataFim, setDataFim] = useState(defaultRange.fim);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempInicio, setTempInicio] = useState(defaultRange.inicio);
  const [tempFim, setTempFim] = useState(defaultRange.fim);

  const buscarDados = useCallback(async (inicio?: string, fim?: string) => {
    const di = inicio || dataInicio;
    const df = fim || dataFim;

    setCarregando(true);
    setErro(null);
    setMeta(null);

    try {
      const response = await fetch('/api/sponte-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataInicio: di, dataFim: df }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const detail = errData.detail ? ` Detalhe: ${errData.detail}` : '';
        throw new Error(errData.error ? `${errData.error}${detail}` : `Proxy error: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        setErro(data.error);
        setPendencias([]);
      } else {
        setPendencias(data.pendencias || []);
        setMeta(data.meta || null);
      }

      setUltimaAtualizacao(new Date().toLocaleString('pt-BR'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setErro(msg);
    } finally {
      setCarregando(false);
    }
  }, [dataInicio, dataFim]);

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

  const aplicarPeriodo = (dias: number) => {
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - dias);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const novoInicio = fmt(inicio);
    const novoFim = fmt(hoje);
    setDataInicio(novoInicio);
    setDataFim(novoFim);
    setTempInicio(novoInicio);
    setTempFim(novoFim);
    setShowDatePicker(false);
    buscarDados(novoInicio, novoFim);
  };

  const aplicarPeriodoCustom = () => {
    const diffDays = calcDiffDays(tempInicio, tempFim);
    if (diffDays > 90) {
      alert('Selecione um período de no máximo 90 dias para garantir a performance.');
      return;
    }
    if (diffDays < 0) {
      alert('A data inicial deve ser anterior à data final.');
      return;
    }
    setDataInicio(tempInicio);
    setDataFim(tempFim);
    setShowDatePicker(false);
    buscarDados(tempInicio, tempFim);
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
  const periodoLabel = getPeriodoLabel(dataInicio, dataFim);

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
              <p className="text-sm text-gray-500">Total Pendente</p>
              <p className="text-xl font-bold text-red-600">{formatarMoeda(totalPendente)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="bg-amber-100 rounded-lg p-2.5">
              <Users size={24} className="text-amber-600" />
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
              <FileText size={24} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Parcelas em Aberto</p>
              <p className="text-xl font-bold text-blue-600">{pendenciasFiltradas.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Period indicator + Date picker */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-indigo-600" />
            <span className="text-sm font-semibold text-indigo-800">Período: {periodoLabel}</span>
            {meta && (
              <span className="text-xs text-indigo-500 flex items-center gap-1">
                <Clock size={12} />
                {meta.tempoSegundos}s
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => aplicarPeriodo(30)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                periodoLabel === 'Últimos 30 dias'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-100'
              }`}
            >
              30 dias
            </button>
            <button
              onClick={() => aplicarPeriodo(60)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                periodoLabel === 'Últimos 60 dias'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-100'
              }`}
            >
              60 dias
            </button>
            <button
              onClick={() => aplicarPeriodo(90)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                periodoLabel === 'Últimos 90 dias'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-100'
              }`}
            >
              90 dias
            </button>
            <button
              onClick={() => {
                setTempInicio(dataInicio);
                setTempFim(dataFim);
                setShowDatePicker(!showDatePicker);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showDatePicker
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-100'
              }`}
            >
              Personalizar
            </button>
          </div>
        </div>

        {showDatePicker && (
          <div className="mt-3 pt-3 border-t border-indigo-200 flex flex-col sm:flex-row items-start sm:items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-indigo-700 mb-1">Data Inicial</label>
              <input
                type="date"
                value={tempInicio}
                onChange={(e) => setTempInicio(e.target.value)}
                className="px-3 py-1.5 border border-indigo-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-indigo-700 mb-1">Data Final</label>
              <input
                type="date"
                value={tempFim}
                onChange={(e) => setTempFim(e.target.value)}
                className="px-3 py-1.5 border border-indigo-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={aplicarPeriodoCustom}
              disabled={carregando}
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              <Search size={14} />
              Buscar Período
            </button>
            <p className="text-xs text-indigo-500">Máximo: 90 dias por consulta</p>
          </div>
        )}
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
              onClick={() => buscarDados()}
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
                      <p className="text-gray-400 text-xs">Buscando pendências de {formatDateBR(dataInicio)} a {formatDateBR(dataFim)}</p>
                    </div>
                  </td>
                </tr>
              ) : pendenciasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      {erro ? (
                        <AlertTriangle size={40} className="text-amber-400" />
                      ) : filtro ? (
                        <SearchX size={40} className="text-gray-300" />
                      ) : (
                        <PartyPopper size={40} className="text-green-400" />
                      )}
                      <p className="text-gray-500 text-sm font-medium">
                        {erro
                          ? 'Não foi possível carregar os dados'
                          : filtro
                          ? 'Nenhum resultado encontrado para o filtro'
                          : `Nenhuma pendência financeira no período (${periodoLabel})`}
                      </p>
                      {erro && (
                        <p className="text-red-500 text-xs mt-1 max-w-md text-center">{erro}</p>
                      )}
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
