import { useState, useEffect, useCallback, useMemo } from 'react';
import { OnboardingAluno, TarefaOnboardingId, Unidade } from '../types';
import { ONBOARDING_STORAGE_KEY, TAREFAS_INICIAIS, TAREFAS_ONBOARDING } from '../constants';

function carregarOnboarding(): OnboardingAluno[] {
  try {
    const dados = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!dados) return [];
    const parsed = JSON.parse(dados) as OnboardingAluno[];
    return parsed.map((a) => {
      if (!a.tarefas) {
        const tarefas = { ...TAREFAS_INICIAIS };
        return { ...a, tarefas, concluido: false };
      }
      // Migrate old 'inicio-cadastro' key to new task keys
      if ('inicio-cadastro' in a.tarefas) {
        delete (a.tarefas as Record<string, boolean>)['inicio-cadastro'];
      }
      for (const t of TAREFAS_ONBOARDING) {
        if (!(t.id in a.tarefas)) {
          a.tarefas[t.id] = false;
        }
      }
      const todasConcluidas = TAREFAS_ONBOARDING.every((t) => a.tarefas[t.id]);
      return { ...a, concluido: todasConcluidas };
    });
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

  const alunosPendentes = useMemo(
    () => alunos.filter((a) => !a.concluido),
    [alunos]
  );

  const alunosConcluidos = useMemo(
    () => alunos.filter((a) => a.concluido),
    [alunos]
  );

  const adicionarAluno = useCallback(
    (dados: { leadId: string; nomeAluno: string; turma: string; nomePaiMae: string; telefone: string; unidade: Unidade }) => {
      setTodosAlunos((prev) => {
        const jaExiste = prev.some((a) => a.leadId === dados.leadId);
        if (jaExiste) return prev;

        const novo: OnboardingAluno = {
          ...dados,
          id: crypto.randomUUID(),
          tarefas: { ...TAREFAS_INICIAIS },
          concluido: false,
          criadoEm: new Date().toISOString(),
        };
        return [...prev, novo];
      });
    },
    []
  );

  const alternarTarefa = useCallback(
    (alunoId: string, tarefaId: TarefaOnboardingId) => {
      setTodosAlunos((prev) =>
        prev.map((aluno) => {
          if (aluno.id !== alunoId) return aluno;
          const novasTarefas = { ...aluno.tarefas, [tarefaId]: !aluno.tarefas[tarefaId] };
          const todasConcluidas = TAREFAS_ONBOARDING.every((t) => novasTarefas[t.id]);
          return { ...aluno, tarefas: novasTarefas, concluido: todasConcluidas };
        })
      );
    },
    []
  );

  const contarTarefas = useCallback(
    (alunoId: string) => {
      const aluno = todosAlunos.find((a) => a.id === alunoId);
      if (!aluno) return { concluidas: 0, total: TAREFAS_ONBOARDING.length };
      const concluidas = TAREFAS_ONBOARDING.filter((t) => aluno.tarefas[t.id]).length;
      return { concluidas, total: TAREFAS_ONBOARDING.length };
    },
    [todosAlunos]
  );

  const removerAluno = useCallback(
    (alunoId: string) => {
      setTodosAlunos((prev) => prev.filter((a) => a.id !== alunoId));
    },
    []
  );

  return {
    alunos,
    alunosPendentes,
    alunosConcluidos,
    adicionarAluno,
    alternarTarefa,
    contarTarefas,
    removerAluno,
  };
}
