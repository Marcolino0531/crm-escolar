import { useState, useEffect, useCallback, useMemo } from 'react';
import { Lead, ColunaKanban, ItemMatricula, Unidade } from '../types';
import { STORAGE_KEY } from '../constants';

function carregarLeads(): Lead[] {
  try {
    const dados = localStorage.getItem(STORAGE_KEY);
    return dados ? JSON.parse(dados) : [];
  } catch {
    return [];
  }
}

function salvarLeads(leads: Lead[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
}

export function useLeads(unidadeSelecionada: Unidade) {
  const [todosLeads, setTodosLeads] = useState<Lead[]>(carregarLeads);

  useEffect(() => {
    salvarLeads(todosLeads);
  }, [todosLeads]);

  const leads = useMemo(
    () => todosLeads.filter((lead) => lead.unidade === unidadeSelecionada),
    [todosLeads, unidadeSelecionada]
  );

  const adicionarLead = useCallback(
    (dados: Omit<Lead, 'id' | 'coluna' | 'criadoEm'>) => {
      const novoLead: Lead = {
        ...dados,
        id: crypto.randomUUID(),
        coluna: 'contato-inicial',
        criadoEm: new Date().toISOString(),
      };
      setTodosLeads((prev) => [...prev, novoLead]);
    },
    []
  );

  const moverLead = useCallback(
    (leadId: string, novaColuna: ColunaKanban) => {
      setTodosLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId ? { ...lead, coluna: novaColuna } : lead
        )
      );
    },
    []
  );

  const agendarVisita = useCallback(
    (leadId: string, dataVisita: string, horarioVisita: string) => {
      setTodosLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? { ...lead, coluna: 'visita-marcada' as ColunaKanban, dataVisita, horarioVisita }
            : lead
        )
      );
    },
    []
  );

  const registrarNaoMatricula = useCallback(
    (leadId: string, motivoPerda: string, observacaoPerda?: string) => {
      setTodosLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? { ...lead, coluna: 'nao-matricula' as ColunaKanban, motivoPerda, observacaoPerda }
            : lead
        )
      );
    },
    []
  );

  const registrarMatricula = useCallback(
    (leadId: string, itensMatricula: ItemMatricula[]) => {
      setTodosLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? { ...lead, coluna: 'matricula' as ColunaKanban, itensMatricula }
            : lead
        )
      );
    },
    []
  );

  const removerLead = useCallback((leadId: string) => {
    setTodosLeads((prev) => prev.filter((lead) => lead.id !== leadId));
  }, []);

  const leadsporColuna = useCallback(
    (coluna: ColunaKanban) => leads.filter((lead) => lead.coluna === coluna),
    [leads]
  );

  return {
    leads,
    todosLeads,
    adicionarLead,
    moverLead,
    agendarVisita,
    registrarNaoMatricula,
    registrarMatricula,
    removerLead,
    leadsporColuna,
  };
}
