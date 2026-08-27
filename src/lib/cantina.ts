// Regras puras do portal de recarga do cartão da cantina.
//
// Duas responsabilidades sensíveis vivem aqui, sem I/O, para serem testadas
// isoladamente:
//
//  1. A trava de força bruta do login público. O portal usa o CPF do aluno como
//     usuário E senha (decisão consciente do colégio), então a única barreira
//     real contra tentativa em massa é o bloqueio temporário: 5 falhas
//     consecutivas para o MESMO CPF bloqueiam por 15 minutos. O contador é por
//     CPF normalizado (só dígitos) — máscara diferente não cria contador novo —
//     e é persistido no banco, não em memória do processo, porque a função roda
//     em várias instâncias serverless.
//
//  2. O vencimento da cobrança da recarga no Sponte: o da próxima mensalidade
//     em aberto do aluno (assim a recarga vence junto com o que a família já
//     paga) e, quando não existe mensalidade futura em aberto, o dia 5 do mês
//     seguinte.

export const MAX_TENTATIVAS_LOGIN = 5;
export const BLOQUEIO_MINUTOS = 15;

// Estado de tentativas de UM CPF (espelha a linha de cantina_login_attempts).
export interface TentativasLogin {
  falhas: number;
  bloqueadoAte: string | null; // ISO 8601; null = sem bloqueio
}

export const TENTATIVAS_ZERADAS: TentativasLogin = { falhas: 0, bloqueadoAte: null };

// Só dígitos: "123.456.789-01" e "12345678901" são o MESMO CPF (e o mesmo
// contador de falhas).
export function normalizarCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

export function cpfValido(cpf: string): boolean {
  return normalizarCpf(cpf).length === 11;
}

export function estaBloqueado(t: TentativasLogin, agoraISO: string): boolean {
  return t.bloqueadoAte !== null && t.bloqueadoAte > agoraISO;
}

// Minutos que faltam para o bloqueio expirar (arredondado para cima; mínimo 1
// enquanto ainda há bloqueio). É o número mostrado ao usuário.
export function minutosRestantesBloqueio(t: TentativasLogin, agoraISO: string): number {
  if (!estaBloqueado(t, agoraISO)) return 0;
  const restanteMs = Date.parse(t.bloqueadoAte as string) - Date.parse(agoraISO);
  return Math.max(1, Math.ceil(restanteMs / 60000));
}

// Registra UMA falha. Ao completar a 5ª falha consecutiva, bloqueia por 15
// minutos e zera o contador — expirada a janela, o CPF volta a ter as 5
// tentativas cheias (não fica bloqueado para sempre nem bloqueia a cada
// tentativa seguinte).
export function registrarFalha(t: TentativasLogin, agoraISO: string): TentativasLogin {
  // Bloqueio vigente: não acumula nada; a tentativa é rejeitada antes.
  if (estaBloqueado(t, agoraISO)) return t;

  const falhas = t.falhas + 1;
  if (falhas < MAX_TENTATIVAS_LOGIN) return { falhas, bloqueadoAte: null };
  return {
    falhas: 0,
    bloqueadoAte: new Date(Date.parse(agoraISO) + BLOQUEIO_MINUTOS * 60000).toISOString(),
  };
}

// Acerto interrompe a sequência: zera falhas e qualquer bloqueio expirado.
export function registrarSucesso(): TentativasLogin {
  return TENTATIVAS_ZERADAS;
}

// ─── Vencimento da cobrança da recarga ──────────────────────────────────────

export interface ParcelaAberta {
  contaReceberID: string;
  numeroBoleto: string;
  numeroParcela: string;
  vencimento: string; // YYYY-MM-DD
  categoria: string;
  saldo: number;
  quitada: boolean;
}

const CATEGORIA_MENSALIDADE = "mensalidade";

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function parcelasEmAberto<T extends ParcelaAberta>(parcelas: readonly T[]): T[] {
  return parcelas.filter((p) => !p.quitada && Math.round(p.saldo * 100) > 0);
}

// Próxima MENSALIDADE em aberto ainda não vencida. É ela que define o
// vencimento da conta a receber da recarga: o pai paga a recarga no mesmo dia
// em que já paga a escola.
export function proximaMensalidadeEmAberto<T extends ParcelaAberta>(
  parcelas: readonly T[],
  hojeYMD: string,
): T | null {
  const candidatas = parcelasEmAberto(parcelas).filter(
    (p) =>
      p.vencimento !== "" &&
      p.vencimento >= hojeYMD &&
      normalizar(p.categoria).includes(CATEGORIA_MENSALIDADE),
  );
  if (candidatas.length === 0) return null;
  return [...candidatas].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
}

// Categoria financeira da recarga no Sponte (já cadastrada na conta do colégio).
export const CATEGORIA_CANTINA_SPONTE = "Cantina";

// Sem mensalidade futura em aberto (fim do ano letivo, aluno em dia sem próximo
// boleto emitido), o vencimento cai no dia 5 do mês seguinte.
export const DIA_VENCIMENTO_FALLBACK = 5;

export function vencimentoPadraoRecarga(hojeYMD: string): string {
  const [y, m] = hojeYMD.split("-").map((v) => parseInt(v, 10));
  const ano = m === 12 ? y + 1 : y;
  const mes = m === 12 ? 1 : m + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(DIA_VENCIMENTO_FALLBACK).padStart(2, "0")}`;
}

export interface VencimentoRecarga {
  vencimento: string; // YYYY-MM-DD
  origem: "mensalidade" | "padrao";
  mensalidade: ParcelaAberta | null;
}

// Regra acordada: vencimento da próxima mensalidade em aberto do aluno; se não
// houver, dia 5 do mês seguinte.
export function vencimentoRecarga<T extends ParcelaAberta>(
  parcelas: readonly T[],
  hojeYMD: string,
): VencimentoRecarga {
  const mensalidade = proximaMensalidadeEmAberto(parcelas, hojeYMD);
  if (mensalidade) {
    return { vencimento: mensalidade.vencimento, origem: "mensalidade", mensalidade };
  }
  return { vencimento: vencimentoPadraoRecarga(hojeYMD), origem: "padrao", mensalidade: null };
}

export function observacaoRecargaSponte(dataSolicitacaoYMD: string): string {
  const [y, m, d] = dataSolicitacaoYMD.split("-");
  const br = y && m && d ? `${d}/${m}/${y}` : dataSolicitacaoYMD;
  return `Recarga do cartão da cantina — solicitação de ${br}`;
}

// ─── Janela de funcionamento do portal público ──────────────────────────────
//
// Fora do ano letivo o portal não pode receber pedido: de 26/11 a 31/01 não há
// mais boleto do ano para receber a cobrança (dezembro) e não há aula
// (janeiro). A janela é guardada como dia do ano (MM-DD), sem ano, para valer
// automaticamente todo ano; as datas são editáveis na tela interna, para
// acompanhar mudança de calendário letivo.

export interface JanelaPortal {
  abertura: string; // MM-DD (inclusive)
  fechamento: string; // MM-DD (inclusive)
}

export const JANELA_PORTAL_PADRAO: JanelaPortal = { abertura: "02-01", fechamento: "11-25" };

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function mmddValido(mmdd: string): boolean {
  return MMDD.test(mmdd);
}

// Datas inválidas (vindas de configuração corrompida) caem no padrão em vez de
// abrir o portal por acidente em dezembro.
export function janelaPortalSegura(janela: JanelaPortal): JanelaPortal {
  return mmddValido(janela.abertura) && mmddValido(janela.fechamento)
    ? janela
    : JANELA_PORTAL_PADRAO;
}

// Portal aberto no dia? Comparação por MM-DD, com suporte a janela que
// atravessa o ano (abertura > fechamento), caso o calendário mude.
export function portalCantinaAberto(
  hojeYMD: string,
  janela: JanelaPortal = JANELA_PORTAL_PADRAO,
): boolean {
  const { abertura, fechamento } = janelaPortalSegura(janela);
  const hoje = hojeYMD.slice(5, 10);
  if (abertura <= fechamento) return hoje >= abertura && hoje <= fechamento;
  return hoje >= abertura || hoje <= fechamento;
}

function mmddParaBR(mmdd: string): string {
  const [mes, dia] = mmdd.split("-");
  return `${dia}/${mes}`;
}

export function mensagemPortalFechado(janela: JanelaPortal = JANELA_PORTAL_PADRAO): string {
  const { abertura, fechamento } = janelaPortalSegura(janela);
  return `As solicitações de recarga do cartão da cantina ficam disponíveis de ${mmddParaBR(
    abertura,
  )} a ${mmddParaBR(fechamento)}. Fora desse período o serviço fica temporariamente indisponível.`;
}

// ─── Solicitação de recarga ─────────────────────────────────────────────────

export type StatusRecarga = "pendente" | "efetivada" | "lancada_no_boleto";

export const STATUS_RECARGA_LABEL: Record<StatusRecarga, string> = {
  pendente: "Pendente",
  efetivada: "Recarga efetivada",
  lancada_no_boleto: "Lançada no Sponte",
};

export type AcaoRecarga = "efetivar" | "marcar_lancada";

export interface TransicaoRecarga {
  ok: boolean;
  proximoStatus?: StatusRecarga;
  erro?: string;
}

// Transições permitidas da solicitação. É uma máquina de estados de mão única:
// 'pendente' → 'efetivada' (a recarga física do cartão foi feita) e
// 'efetivada' → 'lancada_no_boleto' (a conta a receber da recarga existe no
// Sponte — criada pelo sistema ou lançada à mão pela equipe). Repetir a ação num
// status que já avançou é recusado, então clique duplo não gera transição nem
// histórico duplicado.
export function transicaoRecarga(atual: StatusRecarga, acao: AcaoRecarga): TransicaoRecarga {
  if (acao === "efetivar") {
    if (atual !== "pendente") return { ok: false, erro: "Esta solicitação já foi efetivada." };
    return { ok: true, proximoStatus: "efetivada" };
  }
  if (atual === "lancada_no_boleto") {
    return { ok: false, erro: "Esta solicitação já está marcada como lançada no boleto." };
  }
  if (atual !== "efetivada") {
    return { ok: false, erro: "Efetive a recarga do cartão antes de marcar o lançamento." };
  }
  return { ok: true, proximoStatus: "lancada_no_boleto" };
}

export const VALOR_RECARGA_MINIMO = 1;
export const VALOR_RECARGA_MAXIMO = 2000;

export function valorRecargaValido(valor: number): boolean {
  return (
    Number.isFinite(valor) &&
    Math.round(valor * 100) >= VALOR_RECARGA_MINIMO * 100 &&
    Math.round(valor * 100) <= VALOR_RECARGA_MAXIMO * 100
  );
}

export function formatarBRLRecarga(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Texto que o pai envia ao colégio pelo WhatsApp (o portal só ABRE o WhatsApp
// com a mensagem pronta; nada é disparado pelo sistema).
export function mensagemWhatsAppRecarga(alunoNome: string, valor: number): string {
  return `Olá, fiz uma solicitação de recarga de ${formatarBRLRecarga(valor)} para o aluno ${alunoNome}. Por favor, confirmem a recarga.`;
}

// Recepção do colégio: +55 31 9334-5197. Só dígitos, com DDI, como o wa.me exige.
export const WHATSAPP_RECEPCAO = "553193345197";

// Link wa.me da recepção com a mensagem pronta (o portal só ABRE o WhatsApp;
// nada é disparado pelo sistema).
export function linkWhatsAppRecarga(texto: string): string {
  return `https://wa.me/${WHATSAPP_RECEPCAO}?text=${encodeURIComponent(texto)}`;
}
