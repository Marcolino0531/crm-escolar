// Regras puras da tela interna "Rematrícula — Acompanhamento".
//
// A tela nasce da lista de alunos ATIVOS do Sponte (uma linha por aluno, mesmo
// quem nunca abriu o portal) cruzada com o que o School Hub persistiu: acesso ao
// portal, escolha de parcelamento e auditoria cadastral. Os cards do topo saem
// da MESMA coleção que alimenta a tabela — só o filtro de status separa os dois —,
// por isso contadores e linhas nunca divergem.

import {
  formatarBRL,
  rotuloParcelamentoPrimeira,
  type StatusEscolhaRematricula,
} from "./rematricula";

export type StatusAcompanhamento =
  | "nao_iniciado"
  | "em_andamento"
  | "aguardando_aprovacao"
  | "rematriculado";

export const STATUS_ACOMPANHAMENTO_LABEL: Record<StatusAcompanhamento, string> = {
  nao_iniciado: "Não iniciado",
  em_andamento: "Em andamento",
  aguardando_aprovacao: "Aguardando aprovação",
  rematriculado: "Rematriculado",
};

// Ordenação padrão: quem ainda dá trabalho de cobrança vem primeiro; quem já
// está rematriculado vai para o fim.
const PESO_STATUS: Record<StatusAcompanhamento, number> = {
  nao_iniciado: 0,
  em_andamento: 1,
  aguardando_aprovacao: 2,
  rematriculado: 3,
};

export interface AlunoAtivoAcompanhamento {
  alunoId: string;
  nome: string;
  unidade: string;
  turma: string;
}

export interface EscolhaAcompanhamento {
  id: string;
  unidade: string;
  alunoId: string;
  serie: string;
  valorAnual: number;
  parcelas: number;
  valorParcela: number;
  valorPrimeiraParcela: number;
  anoLetivo: number | null;
  status: StatusEscolhaRematricula;
  atualizadoEm: string;
  sponteContaReceberId: string;
  sponteErro: string;
}

export interface AcessoAcompanhamento {
  unidade: string;
  alunoId: string;
  ultimoAcessoEm: string;
}

export interface LinhaAcompanhamento {
  alunoId: string;
  nome: string;
  unidade: string;
  turma: string;
  status: StatusAcompanhamento;
  atualizadoEm: string | null;
  parcelamento: string;
  cadastroAlterado: boolean;
  escolha: EscolhaAcompanhamento | null;
}

export interface ContadoresAcompanhamento {
  total: number;
  responderam: number;
  naoResponderam: number;
  aguardandoAprovacao: number;
}

// Chave de cruzamento: o AlunoID do Sponte só é único dentro de uma unidade
// (CEC e CEC Baby compartilham credencial, as demais têm token próprio).
export function chaveAluno(unidade: string, alunoId: string): string {
  return `${unidade}::${alunoId}`;
}

// 'efetivada' é a linha que a secretaria já reivindicou mas cujo título ainda
// não existe no Sponte (ou cujo lançamento falhou): continua pendente de
// aprovação para a tela, nunca "Rematriculado".
export function statusAcompanhamento(
  escolha: EscolhaAcompanhamento | null,
  acessou: boolean,
): StatusAcompanhamento {
  if (escolha) {
    return escolha.status === "lancada" ? "rematriculado" : "aguardando_aprovacao";
  }
  return acessou ? "em_andamento" : "nao_iniciado";
}

function rotuloParcelamento(escolha: EscolhaAcompanhamento | null): string {
  if (!escolha) return "";
  return rotuloParcelamentoPrimeira({
    parcelas: escolha.parcelas,
    valorParcela: escolha.valorParcela,
    valorPrimeiraParcela: escolha.valorPrimeiraParcela,
    total: escolha.valorAnual,
  });
}

export function totalParcelamento(escolha: EscolhaAcompanhamento): string {
  return formatarBRL(escolha.valorAnual);
}

export function montarLinhasAcompanhamento(entrada: {
  alunos: readonly AlunoAtivoAcompanhamento[];
  escolhas: readonly EscolhaAcompanhamento[];
  acessos: readonly AcessoAcompanhamento[];
  cadastroAlterados: readonly { unidade: string; alunoId: string }[];
}): LinhaAcompanhamento[] {
  const porEscolha = new Map<string, EscolhaAcompanhamento>();
  for (const e of entrada.escolhas) porEscolha.set(chaveAluno(e.unidade, e.alunoId), e);
  const porAcesso = new Map<string, string>();
  for (const a of entrada.acessos)
    porAcesso.set(chaveAluno(a.unidade, a.alunoId), a.ultimoAcessoEm);
  const alterados = new Set(entrada.cadastroAlterados.map((c) => chaveAluno(c.unidade, c.alunoId)));

  return entrada.alunos.map((aluno) => {
    const chave = chaveAluno(aluno.unidade, aluno.alunoId);
    const escolha = porEscolha.get(chave) ?? null;
    const acesso = porAcesso.get(chave) ?? null;
    // "Última atualização" é a última vez que o responsável mexeu no formulário:
    // vale a mais recente entre o acesso e a escolha.
    const atualizadoEm = [escolha?.atualizadoEm, acesso]
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop();
    return {
      alunoId: aluno.alunoId,
      nome: aluno.nome,
      unidade: aluno.unidade,
      turma: aluno.turma,
      status: statusAcompanhamento(escolha, acesso !== null),
      atualizadoEm: atualizadoEm ?? null,
      parcelamento: rotuloParcelamento(escolha),
      cadastroAlterado: alterados.has(chave),
      escolha,
    };
  });
}

// Unidade, turma e busca por nome afetam a coleção que gera os cards; o filtro
// de status é aplicado depois, sobre ela.
export function filtrarAcompanhamento(
  linhas: readonly LinhaAcompanhamento[],
  filtros: {
    unidade?: string | null;
    unidadesPermitidas?: readonly string[];
    turma?: string | null;
    busca?: string;
  },
): LinhaAcompanhamento[] {
  const termo = (filtros.busca ?? "").trim().toLowerCase();
  const permitidas = filtros.unidadesPermitidas ? new Set(filtros.unidadesPermitidas) : null;
  return linhas.filter((l) => {
    if (filtros.unidade ? l.unidade !== filtros.unidade : permitidas && !permitidas.has(l.unidade))
      return false;
    if (filtros.turma && l.turma !== filtros.turma) return false;
    if (!termo) return true;
    return l.nome.toLowerCase().includes(termo);
  });
}

// Opções do filtro de Turma: saem das próprias linhas já restritas à unidade,
// para nunca oferecer turma de outra unidade.
export function turmasAcompanhamento(linhas: readonly LinhaAcompanhamento[]): string[] {
  const turmas = new Set<string>();
  for (const l of linhas) if (l.turma) turmas.add(l.turma);
  return [...turmas].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function filtrarPorStatus(
  linhas: readonly LinhaAcompanhamento[],
  status: StatusAcompanhamento | "todos",
): LinhaAcompanhamento[] {
  if (status === "todos") return [...linhas];
  return linhas.filter((l) => l.status === status);
}

export function ordenarAcompanhamento(
  linhas: readonly LinhaAcompanhamento[],
): LinhaAcompanhamento[] {
  return [...linhas].sort((a, b) => {
    const peso = PESO_STATUS[a.status] - PESO_STATUS[b.status];
    if (peso !== 0) return peso;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

// "Já respondeu" é quem confirmou o parcelamento (pendente de aprovação ou já
// lançado). Quem só abriu o portal e não confirmou continua como não respondido,
// porque é dele que a escola precisa cobrar retorno.
export function respondeu(linha: LinhaAcompanhamento): boolean {
  return linha.status === "aguardando_aprovacao" || linha.status === "rematriculado";
}

export function contadoresAcompanhamento(
  linhas: readonly LinhaAcompanhamento[],
): ContadoresAcompanhamento {
  const responderam = linhas.filter(respondeu).length;
  return {
    total: linhas.length,
    responderam,
    naoResponderam: linhas.length - responderam,
    aguardandoAprovacao: linhas.filter((l) => l.status === "aguardando_aprovacao").length,
  };
}
