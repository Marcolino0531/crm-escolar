// Etapa "Acordo" da Cobrança — lógica pura (sem Supabase nem Sponte).
//
// Pareia as parcelas do Termo de Confissão de Dívida (snapshot.parcelas) com as
// parcelas de categoria "Acordo" do Sponte, calcula a situação de cada uma,
// os totais, a quitação automática e o valor da causa sugerido em caso de
// quebra. Regra monetária de atraso: SEMPRE `valorAtualizadoParcela`.

import { diasEntreYMD, valorAtualizadoParcela } from "@/lib/billing-debt";
import type { ParcelaTermo } from "@/lib/confissao-divida";

export const CATEGORIA_ACORDO_SPONTE = "Acordo";
export const TOLERANCIA_VENCIMENTO_DIAS = 5;
export const DIAS_ATRASO_VENCIMENTO_ANTECIPADO = 15;
export const CLAUSULA_PENAL_ACORDO = 0.2;
export const NOTA_VALOR_CAUSA_ACORDO = "sem correção monetária";
export const MARCOS_AVISO_ACORDO = [1, 15] as const;
export type MarcoAvisoAcordo = (typeof MARCOS_AVISO_ACORDO)[number];

/** Parcela "Acordo" lida do Sponte (GetParcelas), aberta ou quitada. */
export interface ParcelaAcordoSponte {
  contaReceberID: string;
  alunoId: string;
  vencimento: string; // YYYY-MM-DD
  valor: number;
  valorPago: number;
  saldo: number;
  quitada: boolean;
  dataPagamento: string; // YYYY-MM-DD ou ""
}

export type SituacaoParcelaAcordo =
  | "paga"
  | "paga_parcialmente"
  | "a_vencer"
  | "em_atraso"
  | "nao_encontrada";

export interface ParcelaAcordoAcompanhada {
  numero: number;
  total: number;
  valor: number;
  vencimento: string;
  situacao: SituacaoParcelaAcordo;
  diasAtraso: number;
  valorPago: number;
  saldo: number;
  dataPagamento: string | null;
  contaReceberID: string | null;
}

export interface AcompanhamentoAcordo {
  parcelas: ParcelaAcordoAcompanhada[];
  totalAcordo: number;
  totalPago: number;
  saldoRestante: number;
  proximaParcela: ParcelaAcordoAcompanhada | null;
  quitado: boolean;
  temNaoEncontrada: boolean;
  maiorAtrasoDias: number;
}

function centavos(v: number): number {
  return Math.round(v * 100);
}

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Pareia cada parcela do termo com uma parcela "Acordo" do Sponte: mesmo valor
 * em centavos e vencimento a até 5 dias corridos, escolhendo a mais próxima;
 * cada parcela do Sponte é usada uma única vez.
 */
export function parearParcelasAcordo(
  termo: readonly ParcelaTermo[],
  sponte: readonly ParcelaAcordoSponte[],
): Map<number, ParcelaAcordoSponte> {
  const usadas = new Set<string>();
  const pares = new Map<number, ParcelaAcordoSponte>();
  for (const p of [...termo].sort((a, b) => a.numero - b.numero)) {
    let melhor: ParcelaAcordoSponte | null = null;
    let melhorDist = Infinity;
    for (const s of sponte) {
      if (usadas.has(s.contaReceberID)) continue;
      if (centavos(s.valor) !== centavos(p.valor)) continue;
      const dist = Math.abs(diasEntreYMD(p.vencimento, s.vencimento));
      if (dist > TOLERANCIA_VENCIMENTO_DIAS || dist >= melhorDist) continue;
      melhor = s;
      melhorDist = dist;
    }
    if (melhor) {
      usadas.add(melhor.contaReceberID);
      pares.set(p.numero, melhor);
    }
  }
  return pares;
}

export function acompanharAcordo(
  termo: readonly ParcelaTermo[],
  sponte: readonly ParcelaAcordoSponte[],
  hojeYMD: string,
): AcompanhamentoAcordo {
  const pares = parearParcelasAcordo(termo, sponte);
  const total = termo.length;
  const parcelas: ParcelaAcordoAcompanhada[] = [...termo]
    .sort((a, b) => a.numero - b.numero)
    .map((p) => {
      const s = pares.get(p.numero) ?? null;
      if (!s) {
        return {
          numero: p.numero,
          total,
          valor: p.valor,
          vencimento: p.vencimento,
          situacao: "nao_encontrada",
          diasAtraso: 0,
          valorPago: 0,
          saldo: p.valor,
          dataPagamento: null,
          contaReceberID: null,
        };
      }
      const atraso = diasEntreYMD(s.vencimento, hojeYMD);
      let situacao: SituacaoParcelaAcordo;
      if (s.quitada || s.saldo <= 0) situacao = "paga";
      else if (s.valorPago > 0) situacao = "paga_parcialmente";
      else if (atraso > 0) situacao = "em_atraso";
      else situacao = "a_vencer";
      const emAberto = situacao !== "paga";
      return {
        numero: p.numero,
        total,
        valor: p.valor,
        vencimento: s.vencimento,
        situacao,
        diasAtraso: emAberto && atraso > 0 ? atraso : 0,
        valorPago: situacao === "paga" ? s.valorPago || s.valor : s.valorPago,
        saldo: situacao === "paga" ? 0 : Math.max(0, s.saldo),
        dataPagamento: s.dataPagamento || null,
        contaReceberID: s.contaReceberID,
      };
    });

  const totalAcordo = arred(parcelas.reduce((acc, p) => acc + p.valor, 0));
  const totalPago = arred(parcelas.reduce((acc, p) => acc + p.valorPago, 0));
  const saldoRestante = arred(parcelas.reduce((acc, p) => acc + p.saldo, 0));
  const proximaParcela = parcelas.find((p) => p.situacao !== "paga") ?? null;
  return {
    parcelas,
    totalAcordo,
    totalPago,
    saldoRestante,
    proximaParcela,
    quitado: total > 0 && parcelas.every((p) => p.situacao === "paga"),
    temNaoEncontrada: parcelas.some((p) => p.situacao === "nao_encontrada"),
    maiorAtrasoDias: parcelas.reduce((m, p) => Math.max(m, p.diasAtraso), 0),
  };
}

export function labelSituacaoParcela(p: Pick<ParcelaAcordoAcompanhada, "situacao" | "diasAtraso">) {
  switch (p.situacao) {
    case "paga":
      return "Paga";
    case "paga_parcialmente":
      return "Paga parcialmente";
    case "a_vencer":
      return "A vencer";
    case "em_atraso":
      return `Em atraso há ${p.diasAtraso} dia${p.diasAtraso === 1 ? "" : "s"}`;
    case "nao_encontrada":
      return "Não encontrada no Sponte";
  }
}

export function observacaoAcordoQuitado(numeroTermo: number | string): string {
  return `Acordo quitado (Termo nº ${numeroTermo})`;
}

export function temParcelaEmAtraso(a: Pick<AcompanhamentoAcordo, "parcelas">): boolean {
  return a.parcelas.some(
    (p) => p.diasAtraso > 0 && (p.situacao === "em_atraso" || p.situacao === "paga_parcialmente"),
  );
}

export function passouVencimentoAntecipado(
  a: Pick<AcompanhamentoAcordo, "maiorAtrasoDias">,
): boolean {
  return a.maiorAtrasoDias > DIAS_ATRASO_VENCIMENTO_ANTECIPADO;
}

// ─── Valor da causa (acordo quebrado) ────────────────────────────────────────

export interface ValorCausaAcordo {
  vencidasAtualizadas: number;
  vincendas: number;
  clausulaPenal: number;
  total: number;
  nota: string;
}

/**
 * a) vencidas não pagas: saldo + multa 2% + juros 1%/mês pro rata die;
 * b) vincendas não pagas: saldo sem encargos;
 * c) 20% sobre o saldo principal (a + b, sem encargos) se algum atraso > 15 dias;
 * d) a + b + c, ao centavo. Sem correção monetária.
 */
export function valorCausaAcordo(
  a: Pick<AcompanhamentoAcordo, "parcelas" | "maiorAtrasoDias">,
  hojeYMD: string,
): ValorCausaAcordo {
  let vencidas = 0;
  let vincendas = 0;
  let principal = 0;
  for (const p of a.parcelas) {
    if (p.situacao === "paga" || p.saldo <= 0) continue;
    principal += p.saldo;
    if (diasEntreYMD(p.vencimento, hojeYMD) > 0)
      vencidas += valorAtualizadoParcela(p.saldo, p.vencimento, hojeYMD);
    else vincendas += p.saldo;
  }
  const vencidasAtualizadas = arred(vencidas);
  const vincendasArr = arred(vincendas);
  const clausulaPenal = passouVencimentoAntecipado(a)
    ? arred(principal * CLAUSULA_PENAL_ACORDO)
    : 0;
  return {
    vencidasAtualizadas,
    vincendas: vincendasArr,
    clausulaPenal,
    total: arred(vencidasAtualizadas + vincendasArr + clausulaPenal),
    nota: NOTA_VALOR_CAUSA_ACORDO,
  };
}

// ─── Avisos no sino ──────────────────────────────────────────────────────────

export interface AvisoAcordo {
  casoId: string;
  unidade: string;
  responsavelNome: string;
  numeroTermo: number;
  parcelaNumero: number;
  parcelaTotal: number;
  diasAtraso: number;
  marco: MarcoAvisoAcordo;
}

export interface AvisoAcordoDispensado {
  casoId: string;
  parcelaNumero: number;
  marco: MarcoAvisoAcordo;
}

/** Marco do aviso: 15 quando passou de 15 dias, 1 a partir do 1º dia de atraso. */
export function marcoAvisoAcordo(diasAtraso: number): MarcoAvisoAcordo | null {
  if (diasAtraso > DIAS_ATRASO_VENCIMENTO_ANTECIPADO) return 15;
  if (diasAtraso >= 1) return 1;
  return null;
}

export function avisosAcordoPendentes(
  casos: readonly {
    casoId: string;
    unidade: string;
    responsavelNome: string;
    numeroTermo: number;
    acompanhamento: Pick<AcompanhamentoAcordo, "parcelas">;
  }[],
  dispensados: readonly AvisoAcordoDispensado[],
): AvisoAcordo[] {
  const chave = (c: string, n: number, m: number) => `${c}:${n}:${m}`;
  const vistos = new Set(dispensados.map((d) => chave(d.casoId, d.parcelaNumero, d.marco)));
  const avisos: AvisoAcordo[] = [];
  for (const c of casos) {
    for (const p of c.acompanhamento.parcelas) {
      if (p.situacao !== "em_atraso" && p.situacao !== "paga_parcialmente") continue;
      const marco = marcoAvisoAcordo(p.diasAtraso);
      if (!marco || vistos.has(chave(c.casoId, p.numero, marco))) continue;
      avisos.push({
        casoId: c.casoId,
        unidade: c.unidade,
        responsavelNome: c.responsavelNome,
        numeroTermo: c.numeroTermo,
        parcelaNumero: p.numero,
        parcelaTotal: p.total,
        diasAtraso: p.diasAtraso,
        marco,
      });
    }
  }
  return avisos.sort((a, b) => b.diasAtraso - a.diasAtraso);
}

export function textoAvisoAcordo(a: AvisoAcordo): string {
  const base = `${a.responsavelNome}: parcela ${a.parcelaNumero}/${a.parcelaTotal} do acordo (Termo nº ${a.numeroTermo}) em atraso há ${a.diasAtraso} dia${a.diasAtraso === 1 ? "" : "s"}`;
  return a.marco === 15 ? `${base} — mais de 15 dias: vencimento antecipado (cláusula 5)` : base;
}

// ─── Escolha do termo ────────────────────────────────────────────────────────

export interface TermoCandidato {
  id: string;
  numero: number;
  dataTermo: string; // YYYY-MM-DD
  valorTotal: number;
  parcelas: ParcelaTermo[];
  alunoIds: string[];
  devedoresCpf: string[];
}

function digitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/** Termo casa com o caso se tem algum aluno do caso ou um devedor com o CPF do responsável. */
export function termoCasaComCaso(
  termo: Pick<TermoCandidato, "alunoIds" | "devedoresCpf">,
  caso: { alunos: readonly { aluno_id: string }[]; responsavel_cpf: string | null },
): boolean {
  const alunos = new Set(caso.alunos.map((a) => a.aluno_id));
  if (termo.alunoIds.some((id) => alunos.has(id))) return true;
  const cpf = digitos(caso.responsavel_cpf);
  return cpf.length > 0 && termo.devedoresCpf.some((c) => digitos(c) === cpf);
}
