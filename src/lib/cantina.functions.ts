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
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
} from "@/lib/sponte.functions";
import {
  TENTATIVAS_ZERADAS,
  cpfValido,
  estaBloqueado,
  linkWhatsAppRecarga,
  mensagemWhatsAppRecarga,
  minutosRestantesBloqueio,
  normalizarCpf,
  proximaParcelaEmAberto,
  registrarFalha,
  registrarSucesso,
  transicaoRecarga,
  valorRecargaValido,
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
        const unidadeReal = creds.segmentaPorTurma
          ? (classificarUnidade(turma) ?? "CEC")
          : unidade;
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

interface RecargaRow {
  id: string;
  unidade: string;
  aluno_id: string;
  aluno_nome: string;
  valor: number;
  status: StatusRecarga;
  historico: { status: string; at: string; por: string }[] | null;
}

async function carregarRecarga(id: string): Promise<RecargaRow | null> {
  const { data, error } = await supabaseAdmin
    .from("cantina_recargas" as never)
    .select("id, unidade, aluno_id, aluno_nome, valor, status, historico")
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
  // Indicação manual: boleto em aberto em que a equipe deve incluir o valor
  // (não existe método no Sponte para lançar isso automaticamente).
  boletoNumero?: string;
  boletoVencimento?: string;
  boletoIndisponivel?: boolean;
}

const IdInputSchema = z.object({ id: z.string().uuid() });

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

    // Consulta o próximo boleto em aberto do aluno APENAS para indicar à equipe
    // onde incluir o valor. Nada é escrito no Sponte.
    const { titulos } = await coletarTitulosAluno(recarga.unidade, recarga.aluno_id);
    const hojeYMD = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
    });
    const proxima = proximaParcelaEmAberto(titulos, hojeYMD);

    const agoraISO = new Date().toISOString();
    const { data: atualizadas, error } = await supabaseAdmin
      .from("cantina_recargas" as never)
      .update({
        status: "efetivada",
        efetivada_at: agoraISO,
        efetivada_por: context.userId,
        efetivada_por_nome: nome,
        boleto_conta_receber_id: proxima?.contaReceberID ?? "",
        boleto_numero: proxima?.numeroBoleto ?? "",
        boleto_vencimento: proxima?.vencimento ?? null,
        boleto_indisponivel: !proxima,
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

    return {
      ok: true,
      boletoNumero: proxima?.numeroBoleto ?? "",
      boletoVencimento: proxima?.vencimento ?? "",
      boletoIndisponivel: !proxima,
    };
  });

const LancarInputSchema = z.object({
  id: z.string().uuid(),
  observacao: z.string().max(500).optional(),
});

// Confirmação MANUAL de que o valor foi incluído no boleto pela equipe. O
// sistema não executa esse lançamento no Sponte — só registra quem o fez.
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
