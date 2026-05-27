import { useState, useEffect, useCallback, useMemo } from 'react';
import { Funcionario, PeriodoFerias, Unidade } from '../types';
import { RH_STORAGE_KEY } from '../constants';

function carregarFuncionarios(): Funcionario[] {
  try {
    const dados = localStorage.getItem(RH_STORAGE_KEY);
    return dados ? JSON.parse(dados) : [];
  } catch {
    return [];
  }
}

function salvarFuncionarios(funcionarios: Funcionario[]) {
  localStorage.setItem(RH_STORAGE_KEY, JSON.stringify(funcionarios));
}

export function useRH(unidadeSelecionada: Unidade) {
  const [todosFuncionarios, setTodosFuncionarios] = useState<Funcionario[]>(carregarFuncionarios);

  useEffect(() => {
    salvarFuncionarios(todosFuncionarios);
  }, [todosFuncionarios]);

  const funcionarios = useMemo(
    () => todosFuncionarios.filter((f) => f.unidade === unidadeSelecionada),
    [todosFuncionarios, unidadeSelecionada]
  );

  const adicionarFuncionario = useCallback(
    (dados: Omit<Funcionario, 'id' | 'ferias' | 'criadoEm'>) => {
      const novo: Funcionario = {
        ...dados,
        id: crypto.randomUUID(),
        ferias: [],
        criadoEm: new Date().toISOString(),
      };
      setTodosFuncionarios((prev) => [...prev, novo]);
    },
    []
  );

  const editarFuncionario = useCallback(
    (id: string, dados: Partial<Omit<Funcionario, 'id' | 'criadoEm'>>) => {
      setTodosFuncionarios((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...dados } : f))
      );
    },
    []
  );

  const removerFuncionario = useCallback((id: string) => {
    setTodosFuncionarios((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const adicionarFerias = useCallback(
    (funcionarioId: string, dataInicio: string, dataFim: string) => {
      const periodo: PeriodoFerias = {
        id: crypto.randomUUID(),
        dataInicio,
        dataFim,
      };
      setTodosFuncionarios((prev) =>
        prev.map((f) =>
          f.id === funcionarioId
            ? { ...f, ferias: [...f.ferias, periodo] }
            : f
        )
      );
    },
    []
  );

  const removerFerias = useCallback(
    (funcionarioId: string, feriasId: string) => {
      setTodosFuncionarios((prev) =>
        prev.map((f) =>
          f.id === funcionarioId
            ? { ...f, ferias: f.ferias.filter((fer) => fer.id !== feriasId) }
            : f
        )
      );
    },
    []
  );

  return {
    funcionarios,
    adicionarFuncionario,
    editarFuncionario,
    removerFuncionario,
    adicionarFerias,
    removerFerias,
  };
}
