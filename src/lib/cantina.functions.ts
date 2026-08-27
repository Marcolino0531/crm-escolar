import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  UNIDADES_SPONTE,
  callSponte,
  checkFault,
  classificarUnidade,
  coletarTitulosAluno,
  escapeXml,
  inserirPlanoSponte,
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
} from "@/lib/sponte.functions";
import {
  CATEGORIA_CANTINA_SPONTE,
  JANELA_PORTAL_PADRAO,
  TENTATIVAS_ZERADAS,
  cpfValido,
  estaBloqueado,
  janelaPortalSegura,
  linkWhatsAppRecarga,
  mensagemPortalFechado,
  mensagemWhatsAppRecarga,
  minutosRestantesBloqueio,
  mmddValido,
  normalizarCpf,
  observacaoRecargaSponte,
  portalCantinaAberto,
  registrarFalha,
  registrarSucesso,
  transicaoRecarga,
  valorRecargaValido,
  vencimentoRecarga,
  type JanelaPortal,
  type StatusRecarga,
  type TentativasLogin,
} from "@/lib/cantina";

// ─── Portal público de recarga da cantina ───────────────────────────────────
//
// O portal é PÚBLICO (sem Supabase Auth): o pai entra com o CPF do aluno como
// usuário e senha. Estas server functions rodam com a service role e são a
// ÚNICA porta de escrita — o cliente anônimo não tem policy em nenhuma das
// tabelas da cantina.
//
// Regras de segurança aplicadas aqui:
//  • mensagem de erro sempre GENÉRICA (não revela se o CPF existe);
//  • toda falha alimenta o contador por CPF (hash), que bloqueia 15 min após 5
//    falhas consecutivas — inclusive falhas na criação da solicitação, porque
//    ela reautentica pelo mesmo caminho;
//  • o CPF nunca é gravado nem registrado em log: só o hash entra no banco.

const ERRO_GENERICO = "Não foi possível entrar. Confira o CPF do aluno e tente novamente.";

// ─── Janela sazonal do portal ───────────────────────────────────────────────

function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export interface StatusPortalResult {
  aberto: boolean;
  mensagem: string;
  janela: JanelaPortal;
}

async function carregarJanelaPortal(): Promise<JanelaPortal> {
  const { data, error } = await supabaseAdmin
    .from("cantina_portal_config" as never)
    .select("abertura_mmdd, fechamento_mmdd")
    .maybeSingle();
  if (error || !data) return JANELA_PORTAL_PADRAO;
  const row = data as unknown as { abertura_mmdd: string; fechamento_mmdd: string };
  return janelaPortalSegura({
    abertura: row.abertura_mmdd,
    fechamento: row.fechamento_mmdd,
  });
}

async function statusPortal(): Promise<StatusPortalResult> {
  const janela = await carregarJanelaPortal();
  // Data do SERVIDOR (fuso de São Paulo): o bloqueio não depende do relógio do
  // dispositivo do responsável.
  const aberto = portalCantinaAberto(hojeSaoPaulo(), janela);
  return { aberto, mensagem: aberto ? "" : mensagemPortalFechado(janela), janela };
}

// Consultada pela página pública para decidir se mostra o formulário — sem
// autenticação, porque precede o login.
export const statusPortalCantina = createServerFn({ method: "GET" }).handler(
  async (): Promise<StatusPortalResult> => statusPortal(),
);

function hashCpf(cpfDigitos: string): string {
  return createHash("sha256").update(`cantina:${cpfDigitos}`).digest("hex");
}

async function lerTentativas(cpfHash: string): Promise<TentativasLogin> {
  const { data, error } = await supabaseAdmin
    .from("cantina_login_attempts" as never)
    .select("falhas, bloqueado_ate")
    .eq("cpf_hash", cpfHash)
    .maybeSingle();
  if (error || !data) return TENTATIVAS_ZERADAS;
  const row = data as unknown as { falhas: number | null; bloqueado_ate: string | null };
  return { falhas: row.falhas ?? 0, bloqueadoAte: row.bloqueado_ate ?? null };
}

async function gravarTentativas(
  cpfHash: string,
  tentativas: TentativasLogin,
  agoraISO: string,
): Promise<void> {
  await supabaseAdmin.from("cantina_login_attempts" as never).upsert(
    {
      cpf_hash: cpfHash,
      falhas: tentativas.falhas,
      bloqueado_ate: tentativas.bloqueadoAte,
      ultima_falha_at: agoraISO,
      updated_at: agoraISO,
    } as never,
    { onConflict: "cpf_hash" } as never,
  );
}

export interface ResponsavelPortal {
  nome: string;
  parentesco: string;
}

export interface AlunoPortal {
  unidade: string;
  alunoId: string;
  nome: string;
  turma: string;
  responsaveis: ResponsavelPortal[];
}

// Procura o aluno pelo CPF em TODAS as unidades com credenciais configuradas.
// A consulta é sempre FILTRADA pelo CPF (nos dois formatos aceitos pelo Sponte,
// como no módulo de Matrículas): o portal nunca varre a lista de alunos. Quando
// o registro traz o CPF de volta, ele ainda é reconferido por dígitos.
function variacoesCpf(cpfDigitos: string): string[] {
  const formatado = `${cpfDigitos.slice(0, 3)}.${cpfDigitos.slice(3, 6)}.${cpfDigitos.slice(
    6,
    9,
  )}-${cpfDigitos.slice(9)}`;
  return [cpfDigitos, formatado];
}

async function buscarAlunoPorCpf(cpfDigitos: string): Promise<AlunoPortal | null> {
  for (const unidade of UNIDADES_SPONTE) {
    const creds = resolverCredenciais(unidade);
    if (!creds) continue;

    for (const variacao of variacoesCpf(cpfDigitos)) {
      let xml: string;
      try {
        xml = await callSponte(
          "GetAlunos",
          `CPF=${escapeXml(variacao)}`,
          creds.codigoCliente,
          creds.token,
        );
      } catch {
        break; // unidade indisponível: tenta a próxima
      }
      if (checkFault(xml)) continue;

      const nodes = parseXmlList(xml, "wsAluno");
      for (const node of nodes) {
        const alunoId = parseXmlValue(node, "AlunoID");
        if (!alunoId || alunoId === "0") continue;

        const cpfAluno = normalizarCpf(
          parseXmlValue(node, "CPF") || parseXmlValue(node, "CPFCNPJ"),
        );
        // Registro sem CPF na resposta: vale o filtro da própria consulta.
        if (cpfAluno !== "" && cpfAluno !== cpfDigitos) continue;

        const turma = parseXmlValue(node, "TurmaAtual");
        // CEC e CEC Baby compartilham o token: a unidade real vem da turma.
        const unidadeReal = creds.segmentaPorTurma ? (classificarUnidade(turma) ?? "CEC") : unidade;
        if (creds.segmentaPorTurma && unidadeReal !== unidade) continue;

        const responsaveis: ResponsavelPortal[] = parseXmlList(node, "wsResponsaveis")
          .map((r) => ({
            nome: parseXmlValue(r, "Nome"),
            parentesco: parseXmlValue(r, "Parentesco"),
          }))
          .filter((r) => r.nome);

        return {
          unidade: unidadeReal,
          alunoId,
          nome: parseXmlValue(node, "Nome"),
          turma,
          responsaveis,
        };
      }
    }
  }
  return null;
}

export interface LoginPortalResult {
  aluno: AlunoPortal | null;
  erro?: string;
  bloqueadoMinutos?: number;
}

const LoginInputSchema = z.object({
  cpf: z.string().min(1).max(40),
  senha: z.string().min(1).max(40),
});

// Autentica (CPF do aluno como usuário e senha) aplicando a trava de força
// bruta. Devolve o aluno ou uma mensagem genérica.
async function autenticarPortal(cpf: string, senha: string): Promise<LoginPortalResult> {
  const cpfDigitos = normalizarCpf(cpf);
  const senhaDigitos = normalizarCpf(senha);
  if (!cpfValido(cpfDigitos)) return { aluno: null, erro: ERRO_GENERICO };

  const cpfHash = hashCpf(cpfDigitos);
  const agoraISO = new Date().toISOString();
  const tentativas = await lerTentativas(cpfHash);

  if (estaBloqueado(tentativas, agoraISO)) {
    const minutos = minutosRestantesBloqueio(tentativas, agoraISO);
    return {
      aluno: null,
      erro: `Acesso bloqueado temporariamente por tentativas incorretas. Tente novamente em ${minutos} minuto(s).`,
      bloqueadoMinutos: minutos,
    };
  }

  const aluno = senhaDigitos === cpfDigitos ? await buscarAlunoPorCpf(cpfDigitos) : null;

  if (!aluno) {
    const proximo = registrarFalha(tentativas, agoraISO);
    await gravarTentativas(cpfHash, proximo, agoraISO);
    if (estaBloqueado(proximo, agoraISO)) {
      const minutos = minutosRestantesBloqueio(proximo, agoraISO);
      return {
        aluno: null,
        erro: `Acesso bloqueado temporariamente por tentativas incorretas. Tente novamente em ${minutos} minuto(s).`,
        bloqueadoMinutos: minutos,
      };
    }
    return { aluno: null, erro: ERRO_GENERICO };
  }

  await gravarTentativas(cpfHash, registrarSucesso(), agoraISO);
  return { aluno };
}

export const loginPortalCantina = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => LoginInputSchema.parse(input))
  .handler(async ({ data }): Promise<LoginPortalResult> => {
    // Fora da janela do calendário o portal não autentica: quem já estava
    // logado no navegador também para aqui.
    const status = await statusPortal();
    if (!status.aberto) return { aluno: null, erro: status.mensagem };
    return autenticarPortal(data.cpf, data.senha);
  });

// ─── Criação da solicitação ─────────────────────────────────────────────────

export interface SolicitarRecargaResult {
  ok: boolean;
  erro?: string;
  bloqueadoMinutos?: number;
  solicitacaoId?: string;
  alunoNome?: string;
  valor?: number;
  mensagemWhatsapp?: string;
  linkWhatsapp?: string;
}

const SolicitarInputSchema = z.object({
  cpf: z.string().min(1).max(40),
  senha: z.string().min(1).max(40),
  valor: z.number().finite(),
});

// Janela em que uma nova solicitação idêntica (mesmo aluno e mesmo valor) é
// tratada como reenvio do mesmo pedido — evita duplicar por duplo clique ou
// reenvio do formulário.
const JANELA_IDEMPOTENCIA_MS = 5 * 60 * 1000;

export const solicitarRecargaCantina = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SolicitarInputSchema.parse(input))
  .handler(async ({ data }): Promise<SolicitarRecargaResult> => {
    const status = await statusPortal();
    if (!status.aberto) return { ok: false, erro: status.mensagem };

    if (!valorRecargaValido(data.valor)) {
      return { ok: false, erro: "Informe um valor de recarga válido." };
    }

    // Reautentica: a criação nunca confia num estado guardado no navegador.
    const auth = await autenticarPortal(data.cpf, data.senha);
    if (!auth.aluno) {
      return { ok: false, erro: auth.erro, bloqueadoMinutos: auth.bloqueadoMinutos };
    }
    const aluno = auth.aluno;
    const valor = Math.round(data.valor * 100) / 100;

    const desde = new Date(Date.now() - JANELA_IDEMPOTENCIA_MS).toISOString();
    const { data: existente } = await supabaseAdmin
      .from("cantina_recargas" as never)
      .select("id")
      .eq("aluno_id", aluno.alunoId)
      .eq("unidade", aluno.unidade)
      .eq("status", "pendente")
      .eq("valor", valor)
      .gte("created_at", desde)
      .maybeSingle();

    let solicitacaoId = (existente as unknown as { id: string } | null)?.id ?? "";
    if (!solicitacaoId) {
      const { data: inserida, error } = await supabaseAdmin
        .from("cantina_recargas" as never)
        .insert({
          unidade: aluno.unidade,
          aluno_id: aluno.alunoId,
          aluno_nome: aluno.nome,
          aluno_turma: aluno.turma,
          responsaveis: aluno.responsaveis,
          valor,
          status: "pendente",
        } as never)
        .select("id")
        .single();
      if (error) return { ok: false, erro: "Não foi possível registrar a solicitação." };
      solicitacaoId = (inserida as unknown as { id: string }).id;
    }

    const mensagem = mensagemWhatsAppRecarga(aluno.nome, valor);
    return {
      ok: true,
      solicitacaoId,
      alunoNome: aluno.nome,
      valor,
      mensagemWhatsapp: mensagem,
      linkWhatsapp: linkWhatsAppRecarga(mensagem),
    };
  });

// ─── Tela interna (equipe) ──────────────────────────────────────────────────

async function assertPodeEditarCantina(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc(
    "can_edit_module" as never,
    { _user_id: userId, _module: "cantina" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para editar a Cantina.");

  const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = (user?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const nome =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    user?.user?.email ||
    "";
  return nome;
}

const JanelaInputSchema = z.object({
  abertura: z.string().min(5).max(5),
  fechamento: z.string().min(5).max(5),
});

// Datas da janela editáveis pela equipe (calendário letivo muda de ano para
// ano). Recusa MM-DD inválido em vez de gravar algo que abriria o portal em
// dezembro.
export const salvarJanelaPortalCantina = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JanelaInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; erro?: string }> => {
    const nome = await assertPodeEditarCantina(context.userId);
    if (!mmddValido(data.abertura) || !mmddValido(data.fechamento)) {
      return { ok: false, erro: "Informe as datas no formato MM-DD (ex.: 02-01 e 11-25)." };
    }
    const { error } = await supabaseAdmin.from("cantina_portal_config" as never).upsert(
      {
        id: true,
        abertura_mmdd: data.abertura,
        fechamento_mmdd: data.fechamento,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_by_nome: nome,
      } as never,
      { onConflict: "id" } as never,
    );
    if (error) return { ok: false, erro: "Não foi possível salvar o período." };
    return { ok: true };
  });

// A tela interna nunca é bloqueada pela janela: ela só mostra o período vigente
// e o estado atual do portal público.
export const obterJanelaPortalCantina = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<StatusPortalResult> => statusPortal());

interface RecargaRow {
  id: string;
  unidade: string;
  aluno_id: string;
  aluno_nome: string;
  valor: number;
  status: StatusRecarga;
  sponte_conta_receber_id: string | null;
  historico: { status: string; at: string; por: string }[] | null;
}

async function carregarRecarga(id: string): Promise<RecargaRow | null> {
  const { data, error } = await supabaseAdmin
    .from("cantina_recargas" as never)
    .select("id, unidade, aluno_id, aluno_nome, valor, status, sponte_conta_receber_id, historico")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as RecargaRow;
}

function historicoCom(
  atual: RecargaRow,
  status: string,
  por: string,
  agoraISO: string,
): { status: string; at: string; por: string }[] {
  return [...(atual.historico ?? []), { status, at: agoraISO, por }];
}

export interface EfetivarRecargaResult {
  ok: boolean;
  erro?: string;
  // Lançamento automático no Sponte (mesmo mecanismo do Fechamento da Colônia:
  // InsertPlano, conta a receber de 1 parcela na categoria "Cantina").
  lancadaNoSponte?: boolean;
  sponteContaReceberId?: string;
  sponteVencimento?: string;
  sponteErro?: string;
}

const IdInputSchema = z.object({ id: z.string().uuid() });

// Guarda o motivo da falha do lançamento para a tela oferecer a retentativa.
async function registrarErroSponte(id: string, erro: string): Promise<void> {
  await supabaseAdmin
    .from("cantina_recargas" as never)
    .update({ sponte_erro: erro } as never)
    .eq("id", id);
}

// Cria a conta a receber da recarga no Sponte e, com a confirmação do Sponte,
// avança a solicitação para 'lancada_no_boleto'. Só é chamada com a linha já
// reivindicada em 'efetivada' (ver abaixo), e a gravação final exige
// status='efetivada' — assim nenhum caminho gera dois títulos para a mesma
// recarga.
async function lancarNoSponte(
  recarga: RecargaRow,
  nome: string,
  userId: string,
): Promise<EfetivarRecargaResult> {
  const hojeYMD = hojeSaoPaulo();
  const titulosResult = await coletarTitulosAluno(recarga.unidade, recarga.aluno_id);
  // Sem conseguir ler as parcelas, o vencimento sairia errado (cairia no
  // fallback como se o aluno não tivesse mensalidade): não lança.
  if (titulosResult.indisponivel || titulosResult.error) {
    const erro =
      titulosResult.error ??
      "Credenciais do Sponte ausentes para esta unidade — nenhuma cobrança foi criada.";
    await registrarErroSponte(recarga.id, erro);
    return { ok: true, lancadaNoSponte: false, sponteErro: erro };
  }

  // Vencimento acordado: próxima mensalidade em aberto do aluno; sem ela, dia 5
  // do mês seguinte.
  const { vencimento } = vencimentoRecarga(titulosResult.titulos, hojeYMD);

  const inserido = await inserirPlanoSponte({
    unidade: recarga.unidade,
    sponteAlunoId: recarga.aluno_id,
    valor: Number(recarga.valor),
    vencimento,
    categoria: CATEGORIA_CANTINA_SPONTE,
    observacao: observacaoRecargaSponte(hojeYMD),
    logTag: "[Cantina][Sponte]",
  });

  if (!inserido.ok) {
    const erro =
      inserido.error ??
      "O Sponte não confirmou a criação da cobrança — nenhuma cobrança foi criada.";
    await registrarErroSponte(recarga.id, erro);
    return { ok: true, lancadaNoSponte: false, sponteErro: erro };
  }

  const agoraISO = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("cantina_recargas" as never)
    .update({
      status: "lancada_no_boleto",
      lancada_at: agoraISO,
      lancada_por: userId,
      lancada_por_nome: nome,
      lancada_automatica: true,
      sponte_conta_receber_id: inserido.contaReceberID ?? "",
      sponte_vencimento: vencimento,
      sponte_erro: "",
      historico: historicoCom(recarga, "lancada_no_boleto", nome, agoraISO),
    } as never)
    .eq("id", recarga.id)
    .eq("status", "efetivada");

  // A cobrança EXISTE no Sponte mesmo se a gravação local falhar — o aviso tem
  // de dizer isso, para ninguém lançar o valor uma segunda vez.
  if (error) {
    const erro = `Cobrança criada no Sponte (conta ${inserido.contaReceberID ?? "sem número"}), mas o School Hub não conseguiu registrar o status. NÃO lance novamente.`;
    await registrarErroSponte(recarga.id, erro);
    return { ok: true, lancadaNoSponte: false, sponteErro: erro };
  }

  return {
    ok: true,
    lancadaNoSponte: true,
    sponteContaReceberId: inserido.contaReceberID,
    sponteVencimento: vencimento,
  };
}

export const efetivarRecargaCantina = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<EfetivarRecargaResult> => {
    const nome = await assertPodeEditarCantina(context.userId);
    const recarga = await carregarRecarga(data.id);
    if (!recarga) return { ok: false, erro: "Solicitação não encontrada." };
    // Efetivação é única: reclique não gera nova efetivação nem novo histórico.
    const transicao = transicaoRecarga(recarga.status, "efetivar");
    if (!transicao.ok) return { ok: false, erro: transicao.erro };

    // Reivindica a linha ANTES de falar com o Sponte: quem perde a corrida do
    // clique duplo não chega a criar cobrança nenhuma.
    const agoraISO = new Date().toISOString();
    const { data: atualizadas, error } = await supabaseAdmin
      .from("cantina_recargas" as never)
      .update({
        status: "efetivada",
        efetivada_at: agoraISO,
        efetivada_por: context.userId,
        efetivada_por_nome: nome,
        historico: historicoCom(recarga, "efetivada", nome, agoraISO),
      } as never)
      .eq("id", recarga.id)
      .eq("status", "pendente")
      .select("id");
    if (error) return { ok: false, erro: "Não foi possível efetivar a solicitação." };
    // Nenhuma linha atualizada = outra pessoa efetivou nesse meio tempo.
    if ((atualizadas ?? []).length === 0) {
      return { ok: false, erro: "Esta solicitação já foi efetivada." };
    }

    return lancarNoSponte({ ...recarga, status: "efetivada" }, nome, context.userId);
  });

// Retentativa do lançamento quando o Sponte falhou no momento da efetivação.
export const lancarRecargaNoSponte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<EfetivarRecargaResult> => {
    const nome = await assertPodeEditarCantina(context.userId);
    const recarga = await carregarRecarga(data.id);
    if (!recarga) return { ok: false, erro: "Solicitação não encontrada." };
    if (recarga.status !== "efetivada") {
      return {
        ok: false,
        erro:
          recarga.status === "pendente"
            ? "Efetive a recarga do cartão antes de lançar no Sponte."
            : "Esta recarga já está lançada no Sponte.",
      };
    }
    // Já existe título: repetir criaria cobrança dobrada para o responsável.
    if (recarga.sponte_conta_receber_id) {
      return { ok: false, erro: "Esta recarga já tem cobrança criada no Sponte." };
    }
    return lancarNoSponte(recarga, nome, context.userId);
  });

const LancarInputSchema = z.object({
  id: z.string().uuid(),
  observacao: z.string().max(500).optional(),
});

// Saída de emergência: a equipe lançou o valor à mão no Sponte (quando a
// criação automática falha, por exemplo por configuração da conta). Aqui o
// sistema não escreve nada no Sponte — só registra quem confirmou.
// lancada_automatica fica false, distinguindo do lançamento do sistema.
export const marcarRecargaLancadaNoBoleto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LancarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; erro?: string }> => {
    const nome = await assertPodeEditarCantina(context.userId);
    const recarga = await carregarRecarga(data.id);
    if (!recarga) return { ok: false, erro: "Solicitação não encontrada." };
    const transicao = transicaoRecarga(recarga.status, "marcar_lancada");
    if (!transicao.ok) return { ok: false, erro: transicao.erro };

    const agoraISO = new Date().toISOString();
    const { data: atualizadas, error } = await supabaseAdmin
      .from("cantina_recargas" as never)
      .update({
        status: "lancada_no_boleto",
        lancada_at: agoraISO,
        lancada_por: context.userId,
        lancada_por_nome: nome,
        lancada_automatica: false,
        observacao: data.observacao ?? "",
        historico: historicoCom(recarga, "lancada_no_boleto", nome, agoraISO),
      } as never)
      .eq("id", recarga.id)
      .eq("status", "efetivada")
      .select("id");
    if (error) return { ok: false, erro: "Não foi possível registrar o lançamento." };
    if ((atualizadas ?? []).length === 0) {
      return { ok: false, erro: "Esta solicitação já está marcada como lançada no boleto." };
    }
    return { ok: true };
  });
