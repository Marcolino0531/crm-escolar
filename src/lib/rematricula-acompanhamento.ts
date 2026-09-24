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

// "contrato_enviado" e "matriculado" são o caminho de quem NÃO passou pelo
// portal: matrícula nova lançada no Sponte cujo contrato saiu pela aba
// Documentos (contratos_matricula + zapsign_documentos).
export type StatusAcompanhamento =
  | "nao_iniciado"
  | "em_andamento"
  | "aguardando_aprovacao"
  | "contrato_enviado"
  | "rematriculado"
  | "matriculado";

export const STATUS_ACOMPANHAMENTO_LABEL: Record<StatusAcompanhamento, string> = {
  nao_iniciado: "Não iniciado",
  em_andamento: "Em andamento",
  aguardando_aprovacao: "Aguardando aprovação",
  contrato_enviado: "Contrato enviado, aguardando assinatura",
  rematriculado: "Rematriculado",
  matriculado: "Matriculado",
};

export const STATUS_ACOMPANHAMENTO_ORDEM: readonly StatusAcompanhamento[] = [
  "nao_iniciado",
  "em_andamento",
  "aguardando_aprovacao",
  "contrato_enviado",
  "rematriculado",
  "matriculado",
];

// Ordenação padrão: quem ainda dá trabalho de cobrança vem primeiro; quem já
// está rematriculado/matriculado vai para o fim.
const PESO_STATUS: Record<StatusAcompanhamento, number> = {
  nao_iniciado: 0,
  em_andamento: 1,
  aguardando_aprovacao: 2,
  contrato_enviado: 3,
  rematriculado: 4,
  matriculado: 4,
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

export interface EnvioAcompanhamento {
  unidade: string;
  alunoId: string;
  enviadaEm: string;
}

/** Contrato de Matrícula gerado pela aba Documentos/Contratos, com o retrato da ZapSign. */
export interface ContratoAcompanhamento {
  unidade: string;
  alunoId: string;
  /** contratos_matricula.status */
  status: string;
  /** zapsign_documentos.status ("signed" = todos assinaram); "" sem documento. */
  zapsignStatus: string;
  enviadoEm: string | null;
}

export function contratoAssinado(c: ContratoAcompanhamento): boolean {
  return c.status === "enviado" && c.zapsignStatus === "signed";
}

export function contratoAguardandoAssinatura(c: ContratoAcompanhamento): boolean {
  return c.status === "enviado" && c.zapsignStatus !== "signed";
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

// Só o "Finalizar Matrícula" (envio final) muda o status para aguardando
// aprovação: confirmar o parcelamento do material ou salvar a rotina é
// progresso parcial e conta como "em andamento". 'efetivada' é a linha que a
// secretaria já reivindicou mas cujo título ainda não existe no Sponte (ou cujo
// lançamento falhou): continua pendente de aprovação, nunca "Rematriculado".
//
// Sem envio pelo portal, vale o Contrato de Matrícula gerado direto (aba
// Documentos): enviado e já assinado na ZapSign → "matriculado"; enviado e
// ainda sem assinatura → "contrato_enviado". Contrato cancelado/erro/pendente
// não muda nada. Quem tem envio do portal segue a regra de sempre.
export function statusAcompanhamento(
  escolha: EscolhaAcompanhamento | null,
  acessou: boolean,
  enviada: boolean,
  contrato: ContratoAcompanhamento | null = null,
): StatusAcompanhamento {
  if (enviada) {
    return escolha?.status === "lancada" ? "rematriculado" : "aguardando_aprovacao";
  }
  if (contrato && contratoAssinado(contrato)) return "matriculado";
  if (contrato && contratoAguardandoAssinatura(contrato)) return "contrato_enviado";
  return acessou || escolha ? "em_andamento" : "nao_iniciado";
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
  envios: readonly EnvioAcompanhamento[];
  cadastroAlterados: readonly { unidade: string; alunoId: string }[];
  contratos?: readonly ContratoAcompanhamento[];
}): LinhaAcompanhamento[] {
  const porEnvio = new Map<string, string>();
  for (const e of entrada.envios) porEnvio.set(chaveAluno(e.unidade, e.alunoId), e.enviadaEm);
  const porContrato = new Map<string, ContratoAcompanhamento>();
  for (const c of entrada.contratos ?? []) porContrato.set(chaveAluno(c.unidade, c.alunoId), c);
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
    // vale a mais recente entre o acesso, a escolha e o envio final.
    const envio = porEnvio.get(chave) ?? null;
    const contrato = porContrato.get(chave) ?? null;
    const atualizadoEm = [escolha?.atualizadoEm, acesso, envio, contrato?.enviadoEm]
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop();
    return {
      alunoId: aluno.alunoId,
      nome: aluno.nome,
      unidade: aluno.unidade,
      turma: aluno.turma,
      status: statusAcompanhamento(escolha, acesso !== null, envio !== null, contrato),
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
  const termo = semAcento(filtros.busca ?? "");
  const permitidas = filtros.unidadesPermitidas ? new Set(filtros.unidadesPermitidas) : null;
  return linhas.filter((l) => {
    if (filtros.unidade ? l.unidade !== filtros.unidade : permitidas && !permitidas.has(l.unidade))
      return false;
    if (filtros.turma && l.turma !== filtros.turma) return false;
    if (!termo) return true;
    return semAcento(l.nome).includes(termo);
  });
}

function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
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

// "Já respondeu" é quem clicou em Finalizar Matrícula (pendente de aprovação ou
// já lançado). Quem só abriu o portal ou salvou parte continua como não respondido,
// porque é dele que a escola precisa cobrar retorno.
export function respondeu(linha: LinhaAcompanhamento): boolean {
  return (
    linha.status === "aguardando_aprovacao" ||
    linha.status === "rematriculado" ||
    linha.status === "contrato_enviado" ||
    linha.status === "matriculado"
  );
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

// ─── Revisar e Aprovar: dois lançamentos independentes no Sponte ─────────────
//
// Material Pedagógico e Matrícula são planos distintos no Sponte. A aprovação
// dispara os dois em paralelo e cada um responde por si: o erro de um NUNCA
// esconde o sucesso do outro, e cada resultado vira um toast separado.

export interface ResultadoLancamentoSponte {
  ok: boolean;
  erro?: string;
  lancadaNoSponte?: boolean;
  sponteContaReceberId?: string;
  sponteErro?: string;
}

export interface MensagemLancamento {
  tipo: "sucesso" | "erro";
  texto: string;
}

export interface ResumoLancamentosRevisao {
  mensagens: MensagemLancamento[];
  /** Algum lançamento chegou ao Sponte (a tela deve recarregar o acompanhamento). */
  algumSucesso: boolean;
  /** Tudo o que foi tentado chegou ao Sponte (o modal pode fechar). */
  tudoOk: boolean;
}

function mensagemDe(
  rotulo: string,
  r: ResultadoLancamentoSponte | Error | null,
): MensagemLancamento | null {
  if (r === null) return null;
  if (r instanceof Error) return { tipo: "erro", texto: `${rotulo}: ${r.message}` };
  if (!r.ok) {
    return { tipo: "erro", texto: `${rotulo}: ${r.erro ?? "não foi possível aprovar."}` };
  }
  if (r.lancadaNoSponte) {
    return {
      tipo: r.sponteErro ? "erro" : "sucesso",
      texto: r.sponteErro
        ? `${rotulo} lançado no Sponte (conta ${r.sponteContaReceberId || "sem número"}), mas com pendência: ${r.sponteErro}`
        : `${rotulo} lançado no Sponte (conta a receber ${r.sponteContaReceberId || "sem número"}).`,
    };
  }
  return {
    tipo: "erro",
    texto: `${rotulo} aprovado, mas NÃO foi lançado no Sponte: ${r.sponteErro ?? "falha desconhecida"}`,
  };
}

/** `null` = lançamento não tentado (o aluno não tem aquela escolha). */
export function resumirLancamentosRevisao(entrada: {
  material: ResultadoLancamentoSponte | Error | null;
  matricula: ResultadoLancamentoSponte | Error | null;
}): ResumoLancamentosRevisao {
  const itens = [
    mensagemDe("Material Pedagógico", entrada.material),
    mensagemDe("Matrícula", entrada.matricula),
  ].filter((m): m is MensagemLancamento => m !== null);
  return {
    mensagens: itens,
    algumSucesso: itens.some((m) => m.tipo === "sucesso"),
    tudoOk: itens.length > 0 && itens.every((m) => m.tipo === "sucesso"),
  };
}
