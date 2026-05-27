import { useState, useEffect, useCallback } from 'react';
import { Lead, ColunaKanban } from '../types';
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

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>(carregarLeads);

  useEffect(() => {
    salvarLeads(leads);
  }, [leads]);

  const adicionarLead = useCallback(
    (dados: Omit<Lead, 'id' | 'coluna' | 'criadoEm'>) => {
      const novoLead: Lead = {
        ...dados,
        id: crypto.randomUUID(),
        coluna: 'contato-inicial',
        criadoEm: new Date().toISOString(),
      };
      setLeads((prev) => [...prev, novoLead]);
    },
    []
  );

  const moverLead = useCallback(
    (leadId: string, novaColuna: ColunaKanban) => {
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId ? { ...lead, coluna: novaColuna } : lead
        )
      );
    },
    []
  );

  const removerLead = useCallback((leadId: string) => {
    setLeads((prev) => prev.filter((lead) => lead.id !== leadId));
  }, []);

  const leadsporColuna = useCallback(
    (coluna: ColunaKanban) => leads.filter((lead) => lead.coluna === coluna),
    [leads]
  );

  return { leads, adicionarLead, moverLead, removerLead, leadsporColuna };
}
