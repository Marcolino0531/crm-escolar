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
//  2. A escolha do próximo boleto em aberto do aluno, que é onde o valor da
//     recarga deve entrar. Nunca se altera vencimento: o alvo é a parcela em
//     aberto de vencimento mais próximo que ainda NÃO venceu, preferindo a
//     mensalidade quando o mês tem mais de uma cobrança.

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

// ─── Próximo boleto em aberto (alvo do lançamento da recarga) ────────────────

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

// Próxima parcela em aberto AINDA NÃO VENCIDA (vencimento >= hoje), de
// vencimento mais próximo. Empate no mesmo dia resolve pela mensalidade (é o
// boleto da escola, não um avulso). Retorna null quando o aluno só tem parcelas
// vencidas (ou nenhuma em aberto): nesse caso não existe "próximo boleto" para
// receber a recarga e a equipe trata manualmente.
export function proximaParcelaEmAberto<T extends ParcelaAberta>(
  parcelas: readonly T[],
  hojeYMD: string,
): T | null {
  const candidatas = parcelasEmAberto(parcelas).filter(
    (p) => p.vencimento !== "" && p.vencimento >= hojeYMD,
  );
  if (candidatas.length === 0) return null;

  const prioridade = (p: T) => (normalizar(p.categoria).includes(CATEGORIA_MENSALIDADE) ? 0 : 1);
  return [...candidatas].sort(
    (a, b) => a.vencimento.localeCompare(b.vencimento) || prioridade(a) - prioridade(b),
  )[0];
}

// ─── Solicitação de recarga ─────────────────────────────────────────────────

export type StatusRecarga = "pendente" | "efetivada" | "lancada_no_boleto";

export const STATUS_RECARGA_LABEL: Record<StatusRecarga, string> = {
  pendente: "Pendente",
  efetivada: "Recarga efetivada",
  lancada_no_boleto: "Lançada no boleto",
};

export type AcaoRecarga = "efetivar" | "marcar_lancada";

export interface TransicaoRecarga {
  ok: boolean;
  proximoStatus?: StatusRecarga;
  erro?: string;
}

// Transições permitidas da solicitação. É uma máquina de estados de mão única:
// 'pendente' → 'efetivada' (a recarga física do cartão foi feita) e
// 'efetivada' → 'lancada_no_boleto' (alguém CONFIRMOU MANUALMENTE ter incluído
// o valor no boleto — o sistema não escreve nada no Sponte). Repetir a ação num
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

// Indicação MANUAL para a equipe: em qual boleto incluir o valor da recarga.
// Sem próxima parcela em aberto, o texto orienta o lançamento no próximo boleto
// a ser emitido — nunca afirma que algo foi lançado automaticamente.
export function indicacaoLancamentoManual(
  valor: number,
  parcela: { numeroBoleto: string; vencimento: string } | null,
): string {
  const quanto = formatarBRLRecarga(valor);
  if (!parcela) return `Incluir ${quanto} manualmente no próximo boleto a ser emitido.`;
  const [y, m, d] = parcela.vencimento.split("-");
  const venc = y && m && d ? `${d}/${m}/${y}` : parcela.vencimento;
  return `Incluir ${quanto} no boleto ${parcela.numeroBoleto || "sem número"} (vencimento ${venc}).`;
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
