import { useState, useEffect, useCallback, useMemo } from 'react';
import { OnboardingAluno, ColunaOnboarding, Unidade } from '../types';
import { ONBOARDING_STORAGE_KEY } from '../constants';

function carregarOnboarding(): OnboardingAluno[] {
  try {
    const dados = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    return dados ? JSON.parse(dados) : [];
  } catch {
    return [];
  }
}

function salvarOnboarding(alunos: OnboardingAluno[]) {
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(alunos));
}

export function useOnboarding(unidadeSelecionada: Unidade) {
  const [todosAlunos, setTodosAlunos] = useState<OnboardingAluno[]>(carregarOnboarding);

  useEffect(() => {
    salvarOnboarding(todosAlunos);
  }, [todosAlunos]);

  const alunos = useMemo(
    () => todosAlunos.filter((a) => a.unidade === unidadeSelecionada),
    [todosAlunos, unidadeSelecionada]
  );

  const adicionarAluno = useCallback(
    (dados: { leadId: string; nomeAluno: string; turma: string; nomePaiMae: string; telefone: string; unidade: Unidade }) => {
      setTodosAlunos((prev) => {
        const jaExiste = prev.some((a) => a.leadId === dados.leadId);
        if (jaExiste) return prev;

        const novo: OnboardingAluno = {
          ...dados,
          id: crypto.randomUUID(),
          coluna: 'ficha-matricula',
          criadoEm: new Date().toISOString(),
        };
        return [...prev, novo];
      });
    },
    []
  );

  const moverAluno = useCallback(
    (alunoId: string, novaColuna: ColunaOnboarding) => {
      setTodosAlunos((prev) =>
        prev.map((aluno) =>
          aluno.id === alunoId ? { ...aluno, coluna: novaColuna } : aluno
        )
      );
    },
    []
  );

  const alunosPorColuna = useCallback(
    (coluna: ColunaOnboarding) => alunos.filter((a) => a.coluna === coluna),
    [alunos]
  );

  return {
    alunos,
    adicionarAluno,
    moverAluno,
    alunosPorColuna,
  };
}
