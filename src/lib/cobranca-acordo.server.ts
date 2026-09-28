// Etapa "Acordo" da Cobrança — leitura do Sponte e persistência (service role).
// Sem autorização aqui: quem chama (server functions / cron) valida RBAC.
// Nada é gravado no Sponte: só GetParcelas via coletarTitulosAluno.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CATEGORIA_ACORDO_SPONTE,
  acompanharAcordo,
  observacaoAcordoQuitado,
  termoCasaComCaso,
  type AcompanhamentoAcordo,
  type ParcelaAcordoSponte,
  type TermoCandidato,
} from "@/lib/cobranca-acordo";
import type { AcordoTimeline, CasoCompleto } from "@/lib/cobranca-casos";
import type { TermoConfissaoSnapshot } from "@/lib/confissao-divida";
import { coletarTitulosAluno } from "@/lib/sponte.functions";
import { fetchAllRows } from "@/lib/supabase-paginate";

const LOG = "[cobrança acordo]";

interface TermoRow {
  id: string;
  numero: number;
  unidade: string;
  data_recibo: string;
  valor_total: number | string;
  snapshot: TermoConfissaoSnapshot | null;
}

const SELECT_TERMO = "id, numero, unidade, data_recibo, valor_total, snapshot";

function paraCandidato(r: TermoRow): TermoCandidato {
  const snap = r.snapshot;
  return {
    id: r.id,
    numero: Number(r.numero),
    dataTermo: String(r.data_recibo).slice(0, 10),
    valorTotal: Number(r.valor_total ?? 0),
    parcelas: (snap?.parcelas ?? []).map((p) => ({
      numero: Number(p.numero),
      valor: Number(p.valor),
      vencimento: String(p.vencimento).slice(0, 10),
    })),
    alunoIds: (snap?.alunos ?? []).map((a) => String(a.alunoId)),
    devedoresCpf: (snap?.devedores ?? []).map((d) => d.cpf ?? ""),
  };
}

export async function carregarTermo(documentoId: string): Promise<TermoCandidato | null> {
  const { data, error } = await supabaseAdmin
    .from("documentos_recibos" as never)
    .select(SELECT_TERMO)
    .eq("id", documentoId)
    .eq("tipo", "termo_confissao_divida")
    .maybeSingle<TermoRow>();
  if (error) throw new Error(error.message);
  return data ? paraCandidato(data) : null;
}

/** Termos da unidade do caso que casam com ele e ainda não estão ligados a outro caso. */
export async function termosDisponiveis(caso: CasoCompleto): Promise<TermoCandidato[]> {
  const rows = await fetchAllRows<TermoRow>((from, to) =>
    supabaseAdmin
      .from("documentos_recibos" as never)
      .select(SELECT_TERMO)
      .eq("tipo", "termo_confissao_divida")
      .eq("unidade", caso.unidade)
      .order("data_recibo", { ascending: false })
      .range(from, to)
      .returns<TermoRow[]>(),
  );
  const ligados = await fetchAllRows<{ acordo_documento_id: string }>((from, to) =>
    supabaseAdmin
      .from("cobranca_casos" as never)
      .select("acordo_documento_id")
      .not("acordo_documento_id", "is", null)
      .neq("id", caso.id)
      .order("id")
      .range(from, to)
      .returns<{ acordo_documento_id: string }[]>(),
  );
  const usados = new Set(ligados.map((l) => l.acordo_documento_id));
  return rows
    .map(paraCandidato)
    .filter((t) => !usados.has(t.id) && t.parcelas.length > 0 && termoCasaComCaso(t, caso));
}

// ─── Sponte ──────────────────────────────────────────────────────────────────

export async function parcelasAcordoDosAlunos(
  caso: Pick<CasoCompleto, "unidade" | "alunos">,
): Promise<{ parcelas: ParcelaAcordoSponte[]; indisponivel: boolean }> {
  const parcelas: ParcelaAcordoSponte[] = [];
  let indisponivel = false;
  for (const a of caso.alunos) {
    const r = await coletarTitulosAluno(caso.unidade, a.aluno_id);
    if (r.indisponivel || r.error) {
      indisponivel = true;
      continue;
    }
    for (const t of r.titulos) {
      if (t.categoria.trim() !== CATEGORIA_ACORDO_SPONTE) continue;
      parcelas.push({
        contaReceberID: t.contaReceberID,
        alunoId: a.aluno_id,
        vencimento: t.vencimento,
        valor: t.valor,
        valorPago: t.valorPago,
        saldo: t.saldo,
        quitada: t.quitada,
        dataPagamento: t.dataPagamento,
      });
    }
  }
  return { parcelas, indisponivel };
}

export interface AcordoSincronizado {
  termo: TermoCandidato;
  acompanhamento: AcompanhamentoAcordo;
  /** Sponte indisponível para algum aluno: leitura parcial, não encerra. */
  indisponivel: boolean;
  encerradoAgora: boolean;
}

export function acordoTimeline(
  s: Pick<AcordoSincronizado, "termo" | "acompanhamento">,
): AcordoTimeline {
  const prox = s.acompanhamento.proximaParcela;
  return {
    documentoId: s.termo.id,
    numeroTermo: s.termo.numero,
    valorTotal: s.termo.valorTotal,
    totalParcelas: s.termo.parcelas.length,
    proximaParcela: prox ? { numero: prox.numero, vencimento: prox.vencimento } : null,
    parcelasPagas: s.acompanhamento.parcelas
      .filter((p) => p.situacao === "paga")
      .map((p) => ({
        numero: p.numero,
        total: p.total,
        dataPagamento: p.dataPagamento ?? p.vencimento,
        valorPago: p.valorPago,
      })),
  };
}

// Leituras recentes do Sponte por caso (só memória da instância): evita repetir
// GetParcelas a cada abertura do sino. Nada disso é persistido no banco.
const TTL_LEITURA_MS = 15 * 60 * 1000;
const leituras = new Map<string, { em: number; valor: AcordoSincronizado }>();

export function lembrarLeitura(casoId: string, valor: AcordoSincronizado): void {
  leituras.set(casoId, { em: Date.now(), valor });
}

export function leituraRecente(casoId: string): AcordoSincronizado | null {
  const l = leituras.get(casoId);
  if (!l) return null;
  if (Date.now() - l.em > TTL_LEITURA_MS) {
    leituras.delete(casoId);
    return null;
  }
  return l.valor;
}

/**
 * Relê o Sponte e, se TODAS as parcelas estiverem pagas, encerra o caso
 * (motivo 'pago', encerrado_por nulo). Só para status 'acordo'. O acompanhamento
 * não é persistido: é recalculado a cada leitura (detalhe, cron, sino).
 */
export async function sincronizarAcordo(
  caso: CasoCompleto,
  hojeYMD: string,
): Promise<AcordoSincronizado | null> {
  if (!caso.acordo_documento_id) return null;
  const termo = await carregarTermo(caso.acordo_documento_id);
  if (!termo) return null;
  const { parcelas, indisponivel } = await parcelasAcordoDosAlunos(caso);
  const acompanhamento = acompanharAcordo(termo.parcelas, parcelas, hojeYMD);

  let encerradoAgora = false;
  if (caso.status === "acordo" && !indisponivel && acompanhamento.quitado) {
    const { error } = await supabaseAdmin
      .from("cobranca_casos" as never)
      .update({
        status: "encerrado",
        motivo_encerramento: "pago",
        observacao_encerramento: observacaoAcordoQuitado(termo.numero),
        encerrado_em: new Date().toISOString(),
        encerrado_por: null,
      } as never)
      .eq("id", caso.id)
      .eq("status", "acordo");
    if (error) throw new Error(error.message);
    encerradoAgora = true;
    console.log(`${LOG} caso ${caso.id} encerrado: acordo quitado (Termo nº ${termo.numero})`);
  }
  const r = { termo, acompanhamento, indisponivel, encerradoAgora };
  lembrarLeitura(caso.id, r);
  return r;
}

/** Rotina diária: relê todos os casos em acordo (todas as unidades). */
export async function sincronizarAcordosDiario(
  hojeYMD: string,
  carregar: (casoId: string) => Promise<CasoCompleto>,
): Promise<{ sincronizados: number; encerrados: number; falhas: number }> {
  const { data, error } = await supabaseAdmin
    .from("cobranca_casos" as never)
    .select("id")
    .eq("status", "acordo")
    .returns<{ id: string }[]>();
  if (error) throw new Error(error.message);
  let sincronizados = 0;
  let encerrados = 0;
  let falhas = 0;
  for (const { id } of data ?? []) {
    try {
      const r = await sincronizarAcordo(await carregar(id), hojeYMD);
      if (r) sincronizados++;
      if (r?.encerradoAgora) encerrados++;
    } catch (e) {
      falhas++;
      console.error(`${LOG} falha ao sincronizar caso ${id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { sincronizados, encerrados, falhas };
}
