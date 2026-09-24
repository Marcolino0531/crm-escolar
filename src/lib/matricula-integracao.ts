// Situação da integração de uma submissão do formulário de matrícula (alunos
// novos): selos de Turma e Cobrança da lista, filtro "Com pendência", aviso do
// sino e seções financeiras da ficha. Tudo derivado do que já está gravado em
// enrollment_submissions e matricula_faturamento_lancamentos — sem consultar o
// Sponte.

import { formatarBRL } from "@/lib/atendimento-ia";
import {
  ROTULO_TIPO_LANCAMENTO,
  vencimentosAPartirDe,
  type TipoLancamentoMatricula,
} from "@/lib/matricula-faturamento";
import { STATUS_ERRO } from "@/lib/matriculas.audit";

export type SeloTurma = "matriculado" | "pendente" | "erro";
export type SeloCobranca = "lancada" | "parcial" | "pendente" | "erro";

export interface SituacaoSubmissao {
  status: string;
  erro: string | null;
  turma_status: string | null;
  turma_pendencia: string | null;
  turma_nome: string | null;
  faturamento_status: string | null;
  faturamento_pendencia: string | null;
  pendencia_resolvida_em?: string | null;
}

export interface Selo<T extends string> {
  valor: T;
  rotulo: string;
  motivo: string;
}

const ROTULO_TURMA: Record<SeloTurma, string> = {
  matriculado: "Matriculado",
  pendente: "Pendente",
  erro: "Erro",
};

const ROTULO_COBRANCA: Record<SeloCobranca, string> = {
  lancada: "Lançada",
  parcial: "Parcial",
  pendente: "Pendente",
  erro: "Erro",
};

/** Selo "Turma"; null enquanto a matrícula na turma nem chegou a ser tentada. */
export function seloTurma(s: SituacaoSubmissao): Selo<SeloTurma> | null {
  if (s.turma_status === "matriculado") {
    return {
      valor: "matriculado",
      rotulo: ROTULO_TURMA.matriculado,
      motivo: s.turma_nome ? `Matriculado em ${s.turma_nome}` : "Matriculado na turma",
    };
  }
  if (s.turma_status === "erro") {
    return {
      valor: "erro",
      rotulo: ROTULO_TURMA.erro,
      motivo: s.turma_pendencia ?? "Falha ao matricular na turma.",
    };
  }
  if (s.turma_status === "sem_turma") {
    return {
      valor: "pendente",
      rotulo: ROTULO_TURMA.pendente,
      motivo: s.turma_pendencia ?? "Nenhuma turma aberta para a série e o turno.",
    };
  }
  return null;
}

/** Selo "Cobrança"; null enquanto o faturamento nem chegou a ser tentado. */
export function seloCobranca(s: SituacaoSubmissao): Selo<SeloCobranca> | null {
  switch (s.faturamento_status) {
    case "lancado":
      return {
        valor: "lancada",
        rotulo: ROTULO_COBRANCA.lancada,
        motivo: "Todas as cobranças aplicáveis foram lançadas no Sponte.",
      };
    case "parcial":
      return {
        valor: "parcial",
        rotulo: ROTULO_COBRANCA.parcial,
        motivo: s.faturamento_pendencia ?? "Parte das cobranças ficou pendente.",
      };
    case "erro":
      return {
        valor: "erro",
        rotulo: ROTULO_COBRANCA.erro,
        motivo: s.faturamento_pendencia ?? "Falha ao lançar as cobranças.",
      };
    case "sem_lancamento":
    case "sem_plano":
    case "nao_aplicavel":
      return {
        valor: "pendente",
        rotulo: ROTULO_COBRANCA.pendente,
        motivo: s.faturamento_pendencia ?? "Nenhuma cobrança foi lançada.",
      };
    default:
      return null;
  }
}

/**
 * Motivos que tornam a submissão "com pendência": erro na criação no Sponte,
 * turma pendente/erro ou cobrança pendente/parcial/erro. Lista vazia = nada a
 * tratar. Uma pendência marcada como resolvida pela secretaria não conta.
 */
export function motivosPendencia(s: SituacaoSubmissao): string[] {
  if (s.pendencia_resolvida_em) return [];
  const motivos: string[] = [];
  if ((STATUS_ERRO as readonly string[]).includes(s.status)) {
    motivos.push(`Criação no Sponte: ${s.erro ?? "falhou"}`);
  }
  const turma = seloTurma(s);
  if (turma && turma.valor !== "matriculado") motivos.push(`Turma: ${turma.motivo}`);
  const cobranca = seloCobranca(s);
  if (cobranca && cobranca.valor !== "lancada") motivos.push(`Cobrança: ${cobranca.motivo}`);
  return motivos;
}

export function temPendencia(s: SituacaoSubmissao): boolean {
  return motivosPendencia(s).length > 0;
}

/**
 * Filtro `or` do PostgREST equivalente a `temPendencia` (sem a resolução
 * manual, aplicada à parte com `pendencia_resolvida_em IS NULL`).
 */
export const FILTRO_OR_PENDENCIA = [
  `status.in.(${STATUS_ERRO.join(",")})`,
  "turma_status.in.(sem_turma,erro)",
  "faturamento_status.in.(parcial,erro,sem_lancamento,sem_plano,nao_aplicavel)",
].join(",");

// ─── Seções financeiras da ficha ────────────────────────────────────────────

export interface LancamentoFicha {
  tipo: string;
  parcelas: number;
  valor_parcela: number;
  valor_primeira_parcela: number;
  primeiro_vencimento: string | null;
  total: number;
  status: string;
  erro: string | null;
  sponte_conta_receber_id: string | null;
}

export interface SnapshotFinanceiro {
  matricula_valor: number | null;
  matricula_parcelas: number | null;
  matricula_primeiro_vencimento: string | null;
  material_valor_anual: number | null;
  material_parcelas: number | null;
}

export interface CampoFicha {
  rotulo: string;
  valor: string;
}

export interface SecaoFicha {
  titulo: string;
  grupos: { titulo: string | null; campos: CampoFicha[] }[];
}

const ROTULO_STATUS_LANCAMENTO: Record<string, string> = {
  pendente: "Pendente",
  lancado: "Lançado",
  ajuste_pendente: "Lançado (ajuste da 1ª parcela pendente)",
  erro: "Erro",
};

export function dataBR(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "—";
  const [a, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Vencimentos de um lançamento: 1º gravado, demais no dia 05 dos meses seguintes. */
export function vencimentosDoLancamento(l: {
  parcelas: number;
  primeiro_vencimento: string | null;
}): string[] {
  if (!l.primeiro_vencimento || l.parcelas < 1) return [];
  return vencimentosAPartirDe(l.primeiro_vencimento.slice(0, 10), l.parcelas);
}

function listarVencimentos(datas: string[]): string {
  return datas.length === 0 ? "—" : datas.map(dataBR).join(", ");
}

function campoStatus(l: LancamentoFicha | undefined): CampoFicha[] {
  if (!l) return [];
  const campos: CampoFicha[] = [
    { rotulo: "Status no Sponte", valor: ROTULO_STATUS_LANCAMENTO[l.status] ?? l.status },
  ];
  if (l.sponte_conta_receber_id) {
    campos.push({ rotulo: "Conta a receber (Sponte)", valor: l.sponte_conta_receber_id });
  }
  if (l.erro) campos.push({ rotulo: "Erro", valor: l.erro });
  return campos;
}

function secaoMatricula(snap: SnapshotFinanceiro, l: LancamentoFicha | undefined): SecaoFicha {
  const valor = l?.total ?? snap.matricula_valor;
  const parcelas = l?.parcelas ?? snap.matricula_parcelas;
  const primeiro = l?.primeiro_vencimento ?? snap.matricula_primeiro_vencimento;
  if (valor === null || parcelas === null) {
    return {
      titulo: "Matrícula",
      grupos: [
        {
          titulo: null,
          campos: [
            {
              rotulo: "Matrícula",
              valor:
                "Valor da Matrícula não disponível no envio — a secretaria combina o pagamento.",
            },
          ],
        },
      ],
    };
  }
  const datas = vencimentosDoLancamento({ parcelas, primeiro_vencimento: primeiro });
  return {
    titulo: "Matrícula",
    grupos: [
      {
        titulo: null,
        campos: [
          { rotulo: "Valor", valor: formatarBRL(valor) },
          {
            rotulo: "Parcelas escolhidas",
            valor: `${parcelas}x${l ? ` de ${formatarBRL(l.valor_parcela)}` : ""}`,
          },
          { rotulo: "Vencimentos", valor: listarVencimentos(datas) },
          ...campoStatus(l),
        ],
      },
    ],
  };
}

function secaoMensalidades(l: LancamentoFicha | undefined, pendencia: string | null): SecaoFicha {
  if (!l) {
    return {
      titulo: "Mensalidades",
      grupos: [
        {
          titulo: null,
          campos: [
            {
              rotulo: "Mensalidades",
              valor: pendencia ?? "Nenhuma mensalidade lançada pelo formulário.",
            },
          ],
        },
      ],
    };
  }
  return {
    titulo: "Mensalidades",
    grupos: [
      {
        titulo: null,
        campos: [
          { rotulo: "Valor da mensalidade", valor: formatarBRL(l.valor_parcela) },
          { rotulo: "Quantidade", valor: `${l.parcelas}` },
          { rotulo: "Vencimentos", valor: listarVencimentos(vencimentosDoLancamento(l)) },
          ...campoStatus(l),
        ],
      },
    ],
  };
}

function secaoMaterial(snap: SnapshotFinanceiro, l: LancamentoFicha | undefined): SecaoFicha {
  const valorAnual = l?.total ?? snap.material_valor_anual;
  const parcelas = snap.material_parcelas ?? l?.parcelas ?? null;
  if (valorAnual === null || parcelas === null) {
    return {
      titulo: "Material pedagógico",
      grupos: [
        {
          titulo: null,
          campos: [{ rotulo: "Material pedagógico", valor: "Sem escolha de material gravada." }],
        },
      ],
    };
  }
  const campos: CampoFicha[] = [
    { rotulo: "Valor anual", valor: formatarBRL(valorAnual) },
    { rotulo: "Parcelas escolhidas pelo responsável", valor: `${parcelas}x` },
  ];
  if (l && l.parcelas !== parcelas) {
    campos.push({
      rotulo: "Parcelas lançadas",
      valor: `${l.parcelas}x (limitadas às mensalidades restantes)`,
    });
  }
  if (l) {
    campos.push({ rotulo: "Valor da parcela", valor: formatarBRL(l.valor_parcela) });
  }
  campos.push({
    rotulo: "Vencimentos",
    valor: l ? listarVencimentos(vencimentosDoLancamento(l)) : "—",
  });
  campos.push(...campoStatus(l));
  return { titulo: "Material pedagógico", grupos: [{ titulo: null, campos }] };
}

function secaoIntegracao(s: SituacaoSubmissao, lancamentos: LancamentoFicha[]): SecaoFicha {
  const turma = seloTurma(s);
  const cobranca = seloCobranca(s);
  const porTipo = lancamentos.map((l) => ({
    rotulo: ROTULO_TIPO_LANCAMENTO[l.tipo as TipoLancamentoMatricula] ?? l.tipo,
    valor: `${ROTULO_STATUS_LANCAMENTO[l.status] ?? l.status} · ${l.parcelas}x · ${formatarBRL(l.total)}${l.erro ? ` · ${l.erro}` : ""}`,
  }));
  return {
    titulo: "Integração",
    grupos: [
      {
        titulo: "Turma",
        campos: [
          { rotulo: "Status", valor: turma?.rotulo ?? "Não tentada" },
          { rotulo: "Turma", valor: s.turma_nome ?? "—" },
          { rotulo: "Pendência", valor: s.turma_pendencia ?? "—" },
        ],
      },
      {
        titulo: "Faturamento",
        campos: [
          { rotulo: "Status geral", valor: cobranca?.rotulo ?? "Não tentado" },
          { rotulo: "Pendências", valor: s.faturamento_pendencia ?? "—" },
          ...(porTipo.length > 0
            ? porTipo
            : [{ rotulo: "Lançamentos", valor: "Nenhum lançamento registrado." }]),
        ],
      },
    ],
  };
}

export function montarSecoesFinanceiras(
  situacao: SituacaoSubmissao,
  snapshot: SnapshotFinanceiro,
  lancamentos: LancamentoFicha[],
): SecaoFicha[] {
  const porTipo = new Map(lancamentos.map((l) => [l.tipo, l]));
  return [
    secaoMatricula(snapshot, porTipo.get("matricula")),
    secaoMensalidades(porTipo.get("mensalidade"), situacao.faturamento_pendencia),
    secaoMaterial(snapshot, porTipo.get("material")),
    secaoIntegracao(situacao, lancamentos),
  ];
}
