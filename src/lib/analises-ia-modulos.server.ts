// Análises com IA — acesso real aos dados dos módulos operacionais (server-only).
//
// Implementa a `FonteDadosModulos` da lista fechada em `analises-ia-modulos.ts`
// sobre Supabase, Sponte e Nuvemshop. Cada consulta é escopada nas unidades que o
// usuário pode ver e no período pedido, e seleciona apenas as colunas necessárias
// para o agregado: nome, CPF, endereço, telefone, email, corpo de mensagem e IDs
// individuais não atravessam esta fronteira.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  ConversaAtendimentoIA,
  ContrachequeEnvioIA,
  DocumentoEmitidoIA,
  FolhaTransporteIA,
  FonteDadosModulos,
  ItemEstoqueUniformeIA,
  LinhaRematriculaIA,
  PedidoUniformeIA,
  QuadroFuncionariosIA,
  RecargaCantinaIA,
  RepasseEsporteIA,
  SubmissaoMatriculaIA,
  TipoDocumentoIA,
  TurmaAtivosIA,
  TurmaEsporteIA,
} from "@/lib/analises-ia-modulos";
import { configuredStores, fetchPaidOrders } from "@/lib/nuvemshop.server";
import {
  abaixoDoEstoqueMinimo,
  STORES,
  storeKeyForUnitName,
  type StoreKey,
} from "@/lib/nuvemshop.stores";
import { statusAcompanhamento, type EscolhaAcompanhamento } from "@/lib/rematricula-acompanhamento";
import {
  alunosAtivosDaUnidade,
  UNIDADES_SPONTE,
  type AlunosAtivosLoteIRResult,
} from "@/lib/sponte.functions";
import {
  agregaVendasPorPeriodo,
  type CatalogoVariacoes,
  type VendaAgregada,
} from "@/lib/uniformes.vendas";

const TZ = "America/Sao_Paulo";
const PAGE = 1000;

// Data civil (fuso de São Paulo) de um timestamp do banco: recarga solicitada às
// 22h de 31/08 é de agosto, não de setembro como o UTC diria.
function diaBRT(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function inicioDoDia(data: string): string {
  return `${data}T00:00:00-03:00`;
}

function fimDoDia(data: string): string {
  return `${data}T23:59:59.999-03:00`;
}

type IdsDeUnidades = (
  unidades: string[],
) => Promise<{ ids: string[]; nomePorId: Map<string, string> }>;

// `idsDe` vem de fora (`financeiro-ia.server.ts`) para reaproveitar o cache de
// escolas já resolvido pela requisição — e para que o escopo de unidades tenha
// uma única implementação.
export function criarFonteDadosModulos(idsDe: IdsDeUnidades): FonteDadosModulos {
  // Alunos ativos do Sponte são usados por duas ferramentas (Rematrícula e
  // Matrículas) e a consulta é caríssima: uma vez por unidade, por requisição.
  const ativosPorUnidade = new Map<string, Promise<AlunosAtivosLoteIRResult>>();

  function alunosAtivos(unidade: string): Promise<AlunosAtivosLoteIRResult> {
    const cache = ativosPorUnidade.get(unidade);
    if (cache) return cache;
    const promessa = alunosAtivosDaUnidade(unidade);
    ativosPorUnidade.set(unidade, promessa);
    return promessa;
  }

  function unidadesSponte(unidades: string[]): { alvo: string[]; avisos: string[] } {
    const alvo = unidades.filter((u) => UNIDADES_SPONTE.includes(u));
    const fora = unidades.filter((u) => !UNIDADES_SPONTE.includes(u));
    return {
      alvo,
      avisos: fora.map((u) => `${u} não tem integração com o Sponte: alunos ativos indisponíveis.`),
    };
  }

  // ─── Cantina ───────────────────────────────────────────────────────────────
  async function recargasCantina(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<RecargaCantinaIA[]> {
    if (filtro.unidades.length === 0) return [];
    const { data, error } = await supabaseAdmin
      .from("cantina_recargas" as never)
      .select("unidade, valor, status, created_at")
      .in("unidade", filtro.unidades)
      .gte("created_at", inicioDoDia(filtro.dataInicio))
      .lte("created_at", fimDoDia(filtro.dataFim));
    if (error) throw new Error(error.message);

    type Linha = { unidade: string; valor: number | string; status: string; created_at: string };
    return ((data ?? []) as unknown as Linha[]).map((r) => ({
      unidade: r.unidade,
      data: diaBRT(r.created_at),
      status: r.status as RecargaCantinaIA["status"],
      valor: Number(r.valor ?? 0),
    }));
  }

  // ─── Material Pedagógico / Rematrícula ─────────────────────────────────────
  //
  // "Não iniciado" só existe cruzando os alunos ATIVOS do Sponte com o que o
  // portal persistiu: ler apenas as escolhas gravadas esconderia justamente quem
  // ainda não respondeu.
  async function rematriculaMaterial(filtro: { unidades: string[]; anoLetivo?: number }): Promise<{
    linhas: LinhaRematriculaIA[];
    avisos: string[];
  }> {
    const { alvo, avisos } = unidadesSponte(filtro.unidades);
    if (alvo.length === 0) return { linhas: [], avisos };

    const [config, escolhas, acessos] = await Promise.all([
      supabaseAdmin
        .from("rematricula_config" as never)
        .select("ano_letivo")
        .maybeSingle(),
      supabaseAdmin
        .from("rematricula_escolhas" as never)
        .select(
          "id, unidade, aluno_id, serie, valor_anual, parcelas, valor_parcela, valor_primeira_parcela, ano_letivo, status, updated_at",
        )
        .in("unidade", alvo),
      supabaseAdmin
        .from("rematricula_acessos" as never)
        .select("unidade, aluno_id")
        .in("unidade", alvo),
    ]);
    if (escolhas.error) throw new Error(escolhas.error.message);
    if (acessos.error) throw new Error(acessos.error.message);

    const anoConfigurado =
      ((config.data ?? null) as unknown as { ano_letivo: number } | null)?.ano_letivo ?? null;
    if (anoConfigurado === null) {
      avisos.push('O "Ano Letivo de Referência" ainda não foi configurado no módulo Rematrícula.');
    }
    const anoAlvo = filtro.anoLetivo ?? anoConfigurado;

    type EscolhaRow = {
      id: string;
      unidade: string;
      aluno_id: string;
      serie: string;
      valor_anual: number | string;
      parcelas: number;
      valor_parcela: number | string;
      valor_primeira_parcela: number | string | null;
      ano_letivo: number | null;
      status: string;
      updated_at: string;
    };
    type AcessoRow = { unidade: string; aluno_id: string };

    const chave = (unidade: string, alunoId: string) => `${unidade}::${alunoId}`;
    const acessou = new Set(
      ((acessos.data ?? []) as unknown as AcessoRow[]).map((a) => chave(a.unidade, a.aluno_id)),
    );
    const escolhaPorAluno = new Map<string, EscolhaAcompanhamento>();
    for (const r of (escolhas.data ?? []) as unknown as EscolhaRow[]) {
      // Escolha de outro ano letivo não conta como resposta do ano consultado.
      if (anoAlvo !== null && r.ano_letivo !== null && r.ano_letivo !== anoAlvo) continue;
      escolhaPorAluno.set(chave(r.unidade, r.aluno_id), {
        id: r.id,
        unidade: r.unidade,
        alunoId: r.aluno_id,
        serie: r.serie,
        valorAnual: Number(r.valor_anual ?? 0),
        parcelas: r.parcelas,
        valorParcela: Number(r.valor_parcela ?? 0),
        valorPrimeiraParcela: Number(r.valor_primeira_parcela ?? r.valor_parcela ?? 0),
        anoLetivo: r.ano_letivo ?? anoAlvo,
        status: r.status as EscolhaAcompanhamento["status"],
        atualizadoEm: r.updated_at,
        sponteContaReceberId: "",
        sponteErro: "",
      });
    }

    const linhas: LinhaRematriculaIA[] = [];
    for (const unidade of alvo) {
      const ativos = await alunosAtivos(unidade);
      if (ativos.error) avisos.push(`${unidade}: ${ativos.error}`);
      for (const aluno of ativos.alunos) {
        const escolha = escolhaPorAluno.get(chave(unidade, aluno.alunoId)) ?? null;
        linhas.push({
          unidade,
          status: statusAcompanhamento(escolha, acessou.has(chave(unidade, aluno.alunoId))),
          parcelas: escolha?.parcelas ?? null,
          valorAnual: escolha ? escolha.valorAnual : null,
          anoLetivo: escolha?.anoLetivo ?? anoAlvo,
        });
      }
    }
    return { linhas, avisos };
  }

  // ─── Esportes extracurriculares ────────────────────────────────────────────
  async function esportes(filtro: {
    unidades: string[];
    mesInicio: string;
    mesFim: string;
    modalidade?: string;
  }): Promise<{ repasses: RepasseEsporteIA[]; turmas: TurmaEsporteIA[] }> {
    if (filtro.unidades.length === 0) return { repasses: [], turmas: [] };

    type ModalidadeRow = { id: string; nome: string; unidade: string; tipo_repasse: string };
    const modalidades = await supabaseAdmin
      .from("esportes_modalidades" as never)
      .select("id, nome, unidade, tipo_repasse")
      .in("unidade", filtro.unidades);
    if (modalidades.error) throw new Error(modalidades.error.message);

    const alvo = ((modalidades.data ?? []) as unknown as ModalidadeRow[]).filter(
      (m) =>
        !filtro.modalidade || m.nome.toLowerCase().includes(filtro.modalidade.trim().toLowerCase()),
    );
    if (alvo.length === 0) return { repasses: [], turmas: [] };
    const porId = new Map(alvo.map((m) => [m.id, m]));
    const ids = alvo.map((m) => m.id);

    type ParceiroRow = { id: string; modalidade_id: string; nome: string };
    type RepasseRow = {
      modalidade_id: string;
      parceiro_id: string | null;
      mes_referencia: string;
      valor_arrecadado: number | string;
      valor_repasse: number | string;
      valor_retido: number | string;
      pago_em: string | null;
    };
    type MatriculaRow = { modalidade_id: string; turma: string };

    const [parceiros, repasses, matriculas] = await Promise.all([
      supabaseAdmin
        .from("esportes_parceiros" as never)
        .select("id, modalidade_id, nome")
        .in("modalidade_id", ids),
      supabaseAdmin
        .from("esportes_repasses" as never)
        .select(
          "modalidade_id, parceiro_id, mes_referencia, valor_arrecadado, valor_repasse, valor_retido, pago_em",
        )
        .in("modalidade_id", ids)
        .gte("mes_referencia", filtro.mesInicio)
        .lte("mes_referencia", filtro.mesFim),
      supabaseAdmin
        .from("esportes_matriculas" as never)
        .select("modalidade_id, turma")
        .in("modalidade_id", ids),
    ]);
    if (parceiros.error) throw new Error(parceiros.error.message);
    if (repasses.error) throw new Error(repasses.error.message);
    if (matriculas.error) throw new Error(matriculas.error.message);

    const nomeParceiro = new Map(
      ((parceiros.data ?? []) as unknown as ParceiroRow[]).map((p) => [p.id, p.nome]),
    );

    const linhasRepasse: RepasseEsporteIA[] = [];
    for (const r of (repasses.data ?? []) as unknown as RepasseRow[]) {
      const modalidade = porId.get(r.modalidade_id);
      if (!modalidade) continue;
      linhasRepasse.push({
        unidade: modalidade.unidade,
        modalidade: modalidade.nome,
        parceiro: (r.parceiro_id && nomeParceiro.get(r.parceiro_id)) || "—",
        tipoRepasse: modalidade.tipo_repasse === "fixo" ? "fixo" : "percentual",
        mesReferencia: r.mes_referencia,
        valorArrecadado: Number(r.valor_arrecadado ?? 0),
        valorRepasse: Number(r.valor_repasse ?? 0),
        valorRetido: Number(r.valor_retido ?? 0),
        pago: Boolean(r.pago_em),
      });
    }

    // Quantidade de alunos por turma/modalidade: só a contagem sai daqui, nunca
    // as matrículas individuais.
    const contagem = new Map<string, TurmaEsporteIA>();
    for (const m of (matriculas.data ?? []) as unknown as MatriculaRow[]) {
      const modalidade = porId.get(m.modalidade_id);
      if (!modalidade) continue;
      const turma = m.turma || "—";
      const chave = `${modalidade.id}|${turma}`;
      const atual = contagem.get(chave);
      if (atual) {
        atual.quantidadeAlunos += 1;
      } else {
        contagem.set(chave, {
          unidade: modalidade.unidade,
          modalidade: modalidade.nome,
          turma,
          quantidadeAlunos: 1,
        });
      }
    }

    return { repasses: linhasRepasse, turmas: [...contagem.values()] };
  }

  // ─── Uniformes ─────────────────────────────────────────────────────────────
  async function uniformes(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<{
    estoque: ItemEstoqueUniformeIA[];
    pedidos: PedidoUniformeIA[];
    avisos: string[];
  }> {
    const avisos: string[] = [];
    const lojas = new Set<StoreKey>();
    for (const unidade of filtro.unidades) {
      const loja = storeKeyForUnitName(unidade);
      if (loja) lojas.add(loja);
    }
    if (lojas.size === 0) {
      return {
        estoque: [],
        pedidos: [],
        avisos: ["Nenhuma loja Nuvemshop atende as unidades consultadas."],
      };
    }
    const chaves = [...lojas];
    const rotulo = new Map(STORES.map((s) => [s.key, s.label]));

    type VariantRow = {
      ns_variant_id: string;
      ns_product_id: string;
      store_key: StoreKey;
      size: string | null;
      stock: number | null;
      min_stock: number | null;
      order_placed_at: string | null;
    };
    type ProductRow = { ns_product_id: string; store_key: StoreKey; name: string | null };

    const variantes: VariantRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("uniform_variants" as never)
        .select("ns_variant_id, ns_product_id, store_key, size, stock, min_stock, order_placed_at")
        .in("store_key", chaves)
        .order("ns_variant_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const lote = (data ?? []) as unknown as VariantRow[];
      variantes.push(...lote);
      if (lote.length < PAGE) break;
    }

    const produtos = await supabaseAdmin
      .from("uniform_products" as never)
      .select("ns_product_id, store_key, name")
      .in("store_key", chaves);
    if (produtos.error) throw new Error(produtos.error.message);

    const nomePorProduto = new Map<string, string>();
    for (const p of (produtos.data ?? []) as unknown as ProductRow[]) {
      nomePorProduto.set(`${p.store_key}:${p.ns_product_id}`, p.name ?? "");
    }
    const tamanhoPorVariacao = new Map<string, string>();
    for (const v of variantes) {
      tamanhoPorVariacao.set(`${v.store_key}:${v.ns_variant_id}`, v.size ?? "");
    }
    const catalogo: CatalogoVariacoes = { tamanhoPorVariacao, nomePorProduto };

    // Mesma regra do alerta e da planilha de reposição: saldo estritamente
    // abaixo do mínimo configurado.
    const estoque: ItemEstoqueUniformeIA[] = variantes
      .filter((v) => abaixoDoEstoqueMinimo(Number(v.stock ?? 0), Number(v.min_stock ?? 0)))
      .map((v) => ({
        loja: rotulo.get(v.store_key) ?? v.store_key,
        produto: nomePorProduto.get(`${v.store_key}:${v.ns_product_id}`) || "—",
        tamanho: v.size ?? "—",
        estoque: Number(v.stock ?? 0),
        estoqueMinimo: Number(v.min_stock ?? 0),
        pedidoRealizado: Boolean(v.order_placed_at),
      }));

    // A API da Nuvemshop filtra por data de CRIAÇÃO e a venda é contada pela
    // data de PAGAMENTO: a janela de criação começa antes do período pedido para
    // alcançar o pedido criado num mês e pago no seguinte.
    const createdMin = inicioDoDia(diasAntes(filtro.dataInicio, 120));
    const createdMax = fimDoDia(filtro.dataFim);
    const pedidos: PedidoUniformeIA[] = [];
    const configuradas = configuredStores().filter((s) => lojas.has(s.key));
    if (configuradas.length === 0) {
      avisos.push("Nenhuma loja Nuvemshop configurada: volume de pedidos indisponível.");
    }
    for (const loja of configuradas) {
      let vendas: VendaAgregada[];
      try {
        const brutos = await fetchPaidOrders(loja, createdMin, createdMax);
        vendas = agregaVendasPorPeriodo(
          loja.key,
          brutos,
          filtro.dataInicio,
          filtro.dataFim,
          catalogo,
        );
      } catch (e) {
        console.error(`[analises-ia] pedidos da loja ${loja.key} falharam:`, e);
        avisos.push(`Pedidos da loja ${rotulo.get(loja.key) ?? loja.key} indisponíveis.`);
        continue;
      }
      for (const v of vendas) {
        pedidos.push({
          loja: rotulo.get(v.storeKey) ?? v.storeKey,
          produto: v.produto,
          tamanho: v.tamanho,
          quantidade: v.quantidade,
          receita: v.receita,
        });
      }
    }

    return { estoque, pedidos, avisos };
  }

  // ─── Documentos ────────────────────────────────────────────────────────────
  async function documentosEmitidos(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
    tipo?: TipoDocumentoIA;
  }): Promise<DocumentoEmitidoIA[]> {
    if (filtro.unidades.length === 0) return [];
    let query = supabaseAdmin
      .from("documentos_recibos" as never)
      .select("unidade, tipo, data_recibo, valor_total")
      .in("unidade", filtro.unidades)
      .gte("data_recibo", filtro.dataInicio)
      .lte("data_recibo", filtro.dataFim);
    if (filtro.tipo) query = query.eq("tipo", filtro.tipo);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    type Linha = {
      unidade: string;
      tipo: string;
      data_recibo: string;
      valor_total: number | string | null;
    };
    const tipos: TipoDocumentoIA[] = [
      "recibo",
      "declaracao_debitos",
      "declaracao_ir",
      "termo_confissao_divida",
    ];
    return ((data ?? []) as unknown as Linha[])
      .filter((r): r is Linha => tipos.includes(r.tipo as TipoDocumentoIA))
      .map((r) => ({
        unidade: r.unidade,
        tipo: r.tipo as TipoDocumentoIA,
        data: String(r.data_recibo).slice(0, 10),
        valorTotal: Number(r.valor_total ?? 0),
      }));
  }

  // ─── Matrículas (comercial) ────────────────────────────────────────────────
  async function matriculas(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<{ submissoes: SubmissaoMatriculaIA[]; ativos: TurmaAtivosIA[]; avisos: string[] }> {
    if (filtro.unidades.length === 0) return { submissoes: [], ativos: [], avisos: [] };

    // O payload da submissão (nome, CPF, telefone, endereço) nunca é lido aqui.
    const { data, error } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .select("unidade, status, created_at")
      .in("unidade", filtro.unidades)
      .gte("created_at", inicioDoDia(filtro.dataInicio))
      .lte("created_at", fimDoDia(filtro.dataFim));
    if (error) throw new Error(error.message);

    type Linha = { unidade: string | null; status: string; created_at: string };
    const submissoes = ((data ?? []) as unknown as Linha[]).map((r) => ({
      unidade: r.unidade ?? "—",
      status: r.status,
      data: diaBRT(r.created_at),
    }));

    const { alvo, avisos } = unidadesSponte(filtro.unidades);
    const ativos: TurmaAtivosIA[] = [];
    for (const unidade of alvo) {
      const resultado = await alunosAtivos(unidade);
      if (resultado.error) avisos.push(`${unidade}: ${resultado.error}`);
      const turmas = new Map<string, number>();
      for (const aluno of resultado.alunos) {
        const turma = aluno.turma || "—";
        turmas.set(turma, (turmas.get(turma) ?? 0) + 1);
      }
      for (const [turma, quantidadeAlunos] of turmas) {
        ativos.push({ unidade, turma, quantidadeAlunos });
      }
    }
    return { submissoes, ativos, avisos };
  }

  // ─── Atendimento (WhatsApp) ────────────────────────────────────────────────
  async function atendimento(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<{ conversas: ConversaAtendimentoIA[] }> {
    if (filtro.unidades.length === 0) return { conversas: [] };

    type ConversaRow = { id: string; unidade: string };
    const conversas = await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .select("id, unidade")
      .in("unidade", filtro.unidades);
    if (conversas.error) throw new Error(conversas.error.message);
    const unidadePorConversa = new Map(
      ((conversas.data ?? []) as unknown as ConversaRow[]).map((c) => [c.id, c.unidade]),
    );
    if (unidadePorConversa.size === 0) return { conversas: [] };

    // Só direção e instante das mensagens: o corpo e a mídia ficam fora.
    type MensagemRow = {
      conversation_id: string;
      direction: "in" | "out";
      wa_timestamp: string | null;
      created_at: string;
    };
    const mensagens: MensagemRow[] = [];
    const ids = [...unidadePorConversa.keys()];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("whatsapp_messages" as never)
        .select("conversation_id, direction, wa_timestamp, created_at")
        .in("conversation_id", ids)
        .gte("created_at", inicioDoDia(filtro.dataInicio))
        .lte("created_at", fimDoDia(filtro.dataFim))
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const lote = (data ?? []) as unknown as MensagemRow[];
      mensagens.push(...lote);
      if (lote.length < PAGE) break;
    }

    const porConversa = new Map<
      string,
      {
        unidade: string;
        primeira: string;
        recebidas: number;
        enviadas: number;
        entrada: string | null;
        resposta: string | null;
      }
    >();
    for (const m of mensagens) {
      const unidade = unidadePorConversa.get(m.conversation_id);
      if (!unidade) continue;
      const instante = m.wa_timestamp ?? m.created_at;
      const atual = porConversa.get(m.conversation_id) ?? {
        unidade,
        primeira: instante,
        recebidas: 0,
        enviadas: 0,
        entrada: null,
        resposta: null,
      };
      if (instante < atual.primeira) atual.primeira = instante;
      if (m.direction === "in") {
        atual.recebidas += 1;
        if (atual.entrada === null) atual.entrada = instante;
      } else {
        atual.enviadas += 1;
        // Primeira resposta é a primeira saída DEPOIS de uma entrada: sem esse
        // par, o tempo fica null em vez de estimado.
        if (atual.resposta === null && atual.entrada !== null && instante >= atual.entrada) {
          atual.resposta = instante;
        }
      }
      porConversa.set(m.conversation_id, atual);
    }

    return {
      conversas: [...porConversa.values()].map((c) => ({
        unidade: c.unidade,
        data: diaBRT(c.primeira),
        mensagensRecebidas: c.recebidas,
        mensagensEnviadas: c.enviadas,
        primeiraRespostaMinutos:
          c.entrada && c.resposta
            ? Math.max(0, Math.round((Date.parse(c.resposta) - Date.parse(c.entrada)) / 60_000))
            : null,
      })),
    };
  }

  // ─── RH / Folha ────────────────────────────────────────────────────────────
  //
  // Valor de salário não existe no banco (o contracheque é só o PDF recortado e
  // enviado), então esta consulta devolve envios, competências e o quadro de
  // ativos — nunca nome, CPF ou remuneração.
  async function folhaRh(filtro: {
    unidades: string[];
    mesInicio: string;
    mesFim: string;
  }): Promise<{
    contracheques: ContrachequeEnvioIA[];
    folhasTransporte: FolhaTransporteIA[];
    quadro: QuadroFuncionariosIA[];
  }> {
    const { ids, nomePorId } = await idsDe(filtro.unidades);
    if (ids.length === 0) return { contracheques: [], folhasTransporte: [], quadro: [] };

    type PayslipRow = { school_id: string | null; competencia: string; status: string };
    type BatchRow = {
      school_id: string | null;
      reference_month: string | null;
      total_amount: number | string | null;
    };
    type FuncionarioRow = { school_id: string; data_rescisao: string | null };

    const [payslips, lotes, funcionarios] = await Promise.all([
      supabaseAdmin
        .from("hr_payslip_sends" as never)
        .select("school_id, competencia, status")
        .in("school_id", ids)
        .gte("competencia", filtro.mesInicio)
        .lte("competencia", filtro.mesFim),
      supabaseAdmin
        .from("hr_transport_batches" as never)
        .select("school_id, reference_month, total_amount")
        .in("school_id", ids)
        .gte("reference_month", filtro.mesInicio)
        .lte("reference_month", filtro.mesFim),
      supabaseAdmin
        .from("funcionarios" as never)
        .select("school_id, data_rescisao")
        .in("school_id", ids),
    ]);
    if (payslips.error) throw new Error(payslips.error.message);
    if (lotes.error) throw new Error(lotes.error.message);
    if (funcionarios.error) throw new Error(funcionarios.error.message);

    const contracheques: ContrachequeEnvioIA[] = [];
    for (const r of (payslips.data ?? []) as unknown as PayslipRow[]) {
      const unidade = r.school_id ? nomePorId.get(r.school_id) : undefined;
      if (!unidade) continue;
      contracheques.push({ unidade, competencia: r.competencia, status: r.status });
    }

    const folhasTransporte: FolhaTransporteIA[] = [];
    for (const r of (lotes.data ?? []) as unknown as BatchRow[]) {
      const unidade = r.school_id ? nomePorId.get(r.school_id) : undefined;
      if (!unidade || !r.reference_month) continue;
      folhasTransporte.push({
        unidade,
        mesReferencia: r.reference_month,
        valorTotal: Number(r.total_amount ?? 0),
      });
    }

    const ativosPorEscola = new Map<string, number>();
    for (const f of (funcionarios.data ?? []) as unknown as FuncionarioRow[]) {
      if (f.data_rescisao) continue;
      ativosPorEscola.set(f.school_id, (ativosPorEscola.get(f.school_id) ?? 0) + 1);
    }
    const quadro: QuadroFuncionariosIA[] = [];
    for (const id of ids) {
      const unidade = nomePorId.get(id);
      if (!unidade) continue;
      quadro.push({ unidade, funcionariosAtivos: ativosPorEscola.get(id) ?? 0 });
    }

    return { contracheques, folhasTransporte, quadro };
  }

  return {
    recargasCantina,
    rematriculaMaterial,
    esportes,
    uniformes,
    documentosEmitidos,
    matriculas,
    atendimento,
    folhaRh,
  };
}

function diasAntes(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}
