// Assistente de IA do Atendimento — lógica pura (sem rede, sem Supabase).
//
// MODO TREINAMENTO: a IA apenas SUGERE. Nada é enviado ao responsável sem que
// alguém clique em Enviar. Aqui ficam a montagem do contexto mandado para a
// Anthropic, a triagem de assunto sensível e o formato dos registros gravados,
// para poderem ser testados sem chamar a API (que é paga por token).
//
// Os valores financeiros NUNCA são inventados pelo modelo: o contexto entrega o
// bloco de parcelas já consultado no Sponte no momento da sugestão, e o system
// prompt proíbe citar número que não esteja nesse bloco.

export type SituacaoAtendimento =
  | "acordo"
  | "valor"
  | "comprovante"
  | "boleto"
  | "reclamacao"
  | "pedagogico"
  | "outro";

export const LABEL_SITUACAO: Record<SituacaoAtendimento, string> = {
  acordo: "Pedido de acordo/parcelamento",
  valor: "Dúvida sobre valor",
  comprovante: "Pagamento/comprovante",
  boleto: "Segunda via de boleto",
  reclamacao: "Reclamação",
  pedagogico: "Assunto pedagógico/disciplinar",
  outro: "Outro",
};

// Quantas mensagens do fim da conversa entram no contexto. Teto explícito porque
// o custo da API cresce com o tamanho do histórico enviado.
export const MAX_MENSAGENS_CONTEXTO = 30;

// Aviso que substitui o texto sugerido quando o caso não deve ser respondido por
// um rascunho automático.
export const AVISO_SENSIVEL = "Assunto sensível, recomendo responder pessoalmente.";

export const PROMPT_PADRAO = `Você é assistente de atendimento financeiro de uma escola de educação infantil, escrevendo mensagens de WhatsApp para o responsável do aluno.

Diretrizes de tom:
- Cordial, direto e humano. Trate o responsável pelo primeiro nome quando ele estiver no contexto.
- Nunca soe como cobrança agressiva: nada de ameaça, prazo fatal, negativação ou tom de advertência.
- Mensagens curtas, no máximo três parágrafos curtos. Sem saudação protocolar longa e sem assinatura.

Diretrizes de conteúdo:
- Use SOMENTE os valores, vencimentos e nomes que aparecem no bloco "Situação financeira (Sponte)". Nunca calcule, estime ou invente número, data ou nome que não esteja lá. Se o dado necessário não estiver no bloco, diga que vai confirmar e retornar, em vez de arriscar um valor.
- O valor cobrado pela automação é o valor CHEIO do boleto, sem o desconto de pontualidade. O desconto é aplicado automaticamente pelo banco no pagamento feito até a data de vencimento — explique isso quando o responsável estranhar o valor.
- Quando houver acordo de parcelamento registrado, reconheça o acordo e trate apenas do que vencer depois dele.
- Não prometa desconto, abatimento de juros, prorrogação ou cancelamento de cobrança: isso depende de aprovação da escola. Ofereça encaminhar o pedido.
- Não repita cobrança de parcela que o responsável afirma ter pago; peça o comprovante com cordialidade.

Formato da resposta: devolva apenas o texto da mensagem a ser enviada, sem aspas, sem assunto e sem comentários seus.`;

export interface MensagemContexto {
  direcao: "in" | "out";
  corpo: string;
  tipo: "text" | "image" | "document" | "audio" | "system";
  automatica: boolean;
}

export interface ParcelaContexto {
  vencimento: string; // YYYY-MM-DD
  saldo: number;
}

export interface FinanceiroContexto {
  alunoNome: string;
  alunoId: string;
  unidade: string;
  responsavelNome: string;
  parcelas: ParcelaContexto[];
  totalVencido: number;
  // Mês de referência do acordo de parcelamento (YYYY-MM), quando registrado.
  acordoMes: string | null;
  // false quando o Sponte não pôde ser consultado (credencial, fault, rede) ou a
  // conversa não tem aluno vinculado: o prompt então proíbe falar de valores.
  consultaOk: boolean;
}

export interface PromptIA {
  system: string;
  mensagens: { role: "user" | "assistant"; content: string }[];
}

export function formatarBRL(valor: number): string {
  // Espaço normal em vez do NBSP que o Intl insere depois de "R$": o texto vai
  // para uma mensagem de WhatsApp.
  return valor
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    .replace(/\u00a0/g, " ");
}

export function dataBR(ymd: string): string {
  const [a, m, d] = (ymd ?? "").split("-");
  return a && m && d ? `${d}/${m}/${a}` : "";
}

function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Texto que representa a mensagem no contexto. Mídia não é enviada ao modelo:
// entra como marcador, para a IA saber que existe um anexo sem alucinar conteúdo.
export function textoDaMensagem(msg: MensagemContexto): string {
  const corpo = (msg.corpo ?? "").trim();
  if (msg.tipo === "image") return corpo ? `[imagem anexada] ${corpo}` : "[imagem anexada]";
  if (msg.tipo === "document")
    return corpo ? `[documento anexado] ${corpo}` : "[documento anexado]";
  if (msg.tipo === "audio") return "[mensagem de voz — conteúdo não transcrito]";
  return corpo;
}

// Últimas `max` mensagens úteis da conversa, em ordem cronológica. Notas internas
// de sistema (troca de número, por exemplo) ficam fora.
export function limitarHistorico(
  mensagens: MensagemContexto[],
  max = MAX_MENSAGENS_CONTEXTO,
): MensagemContexto[] {
  const uteis = mensagens.filter((m) => m.tipo !== "system" && textoDaMensagem(m) !== "");
  return max > 0 ? uteis.slice(-max) : [];
}

// Última mensagem do responsável — é o que a sugestão precisa responder.
export function ultimaDoResponsavel(mensagens: MensagemContexto[]): MensagemContexto | null {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    if (mensagens[i].direcao === "in" && textoDaMensagem(mensagens[i]) !== "") return mensagens[i];
  }
  return null;
}

const PALAVRAS_SITUACAO: { situacao: SituacaoAtendimento; palavras: string[] }[] = [
  {
    situacao: "pedagogico",
    palavras: [
      "professora",
      "professor",
      "coordenacao",
      "pedagog",
      "adaptacao",
      "mordeu",
      "machucou",
      "briga",
      "bullying",
      "laudo",
      "fonoaudi",
      "comportamento",
      "bercario",
      "soneca",
      "fralda",
    ],
  },
  {
    situacao: "reclamacao",
    palavras: [
      "absurdo",
      "descaso",
      "pessimo",
      "revoltada",
      "revoltado",
      "inaceitavel",
      "vergonha",
      "processar",
      "advogado",
      "procon",
      "justica",
      "reclame aqui",
      "cancelar a matricula",
      "cancelar matricula",
      "tirar meu filho",
      "tirar minha filha",
    ],
  },
  {
    situacao: "acordo",
    palavras: [
      "acordo",
      "parcelar",
      "parcelamento",
      "dividir",
      "negociar",
      "negociacao",
      "prazo",
      "adiar",
      "proximo mes",
      "sem condicoes",
      "desempregad",
    ],
  },
  {
    situacao: "comprovante",
    palavras: [
      "comprovante",
      "ja paguei",
      "paguei",
      "pagamento feito",
      "pix enviado",
      "fiz o pix",
      "transferi",
      "quitei",
    ],
  },
  {
    situacao: "valor",
    palavras: [
      "valor",
      "quanto",
      "cobrado a mais",
      "juros",
      "multa",
      "desconto",
      "pontualidade",
      "esta errado",
      "diferente",
      "atualizado",
    ],
  },
  {
    situacao: "boleto",
    palavras: [
      "boleto",
      "segunda via",
      "2a via",
      "codigo de barras",
      "linha digitavel",
      "vencido",
      "novo vencimento",
      "gerar outro",
    ],
  },
];

// Situação da conversa a partir da última mensagem do responsável. Classificação
// simples por palavra-chave: serve para rotular o registro e, na biblioteca de
// exemplos, para escolher casos parecidos.
export function classificarSituacao(mensagens: MensagemContexto[]): SituacaoAtendimento {
  const ultima = ultimaDoResponsavel(mensagens);
  if (!ultima) return "outro";
  const texto = normalizar(textoDaMensagem(ultima));
  for (const grupo of PALAVRAS_SITUACAO) {
    if (grupo.palavras.some((p) => texto.includes(p))) return grupo.situacao;
  }
  return "outro";
}

export interface TriagemSensivel {
  sensivel: boolean;
  motivo: string;
}

const MOTIVO_SENSIVEL: Partial<Record<SituacaoAtendimento, string>> = {
  reclamacao: "responsável insatisfeito ou ameaçando medida legal",
  pedagogico: "assunto pedagógico/disciplinar, fora do escopo financeiro",
};

// Casos que a IA não deve tentar redigir: insatisfação explícita, ameaça de ação
// legal e assunto fora do financeiro. Nesses casos a sugestão vira um aviso para
// responder pessoalmente, em vez de um rascunho.
export function detectarAssuntoSensivel(mensagens: MensagemContexto[]): TriagemSensivel {
  const situacao = classificarSituacao(mensagens);
  const motivo = MOTIVO_SENSIVEL[situacao];
  return motivo ? { sensivel: true, motivo } : { sensivel: false, motivo: "" };
}

// Bloco de dados reais do Sponte que acompanha o pedido. É a única fonte de
// valores autorizada pelo system prompt.
export function blocoFinanceiro(fin: FinanceiroContexto, hojeYMD: string): string {
  const linhas: string[] = [`Data de hoje: ${dataBR(hojeYMD)}`];
  linhas.push(`Aluno: ${fin.alunoNome || "não identificado"}`);
  if (fin.responsavelNome) linhas.push(`Responsável financeiro: ${fin.responsavelNome}`);
  if (fin.unidade) linhas.push(`Unidade: ${fin.unidade}`);

  if (!fin.consultaOk) {
    linhas.push(
      "Consulta ao Sponte indisponível para esta conversa: NÃO cite valores, vencimentos nem quantidade de parcelas. Ofereça confirmar os dados e retornar.",
    );
    return linhas.join("\n");
  }

  if (fin.parcelas.length === 0) {
    linhas.push("Parcelas em aberto: nenhuma. Não há débito em aberto no Sponte neste momento.");
  } else {
    const vencidas = fin.parcelas.filter((p) => p.vencimento && p.vencimento <= hojeYMD);
    const futuras = fin.parcelas.filter((p) => !p.vencimento || p.vencimento > hojeYMD);
    linhas.push(`Parcelas em aberto (${fin.parcelas.length}):`);
    for (const p of fin.parcelas) {
      const marca = p.vencimento && p.vencimento <= hojeYMD ? "vencida" : "a vencer";
      linhas.push(`- vencimento ${dataBR(p.vencimento)} · ${formatarBRL(p.saldo)} · ${marca}`);
    }
    linhas.push(
      `Total vencido até hoje, já com multa de 2% e juros de 1% ao mês: ${formatarBRL(fin.totalVencido)} (${vencidas.length} parcela(s) vencida(s), ${futuras.length} a vencer).`,
    );
    linhas.push(
      "Os valores acima são o valor cheio do boleto, sem desconto de pontualidade (o banco aplica o desconto no pagamento até o vencimento).",
    );
  }

  if (fin.acordoMes) {
    linhas.push(
      `Acordo de parcelamento registrado com mês de referência ${fin.acordoMes}: parcelas vencidas até o fim desse mês estão fora da cobrança automática.`,
    );
  } else {
    linhas.push("Nenhum acordo de parcelamento registrado para este aluno.");
  }

  return linhas.join("\n");
}

// Contexto completo enviado à Anthropic: instruções (editáveis na tela) + dados
// do Sponte no bloco de sistema, e o histórico da conversa como turnos reais —
// o responsável entra como `user`, a escola como `assistant`, para o modelo
// continuar a conversa em vez de resumi-la.
export function montarPromptIA(input: {
  instrucoes: string;
  financeiro: FinanceiroContexto;
  mensagens: MensagemContexto[];
  hojeYMD: string;
  maxMensagens?: number;
  // Bloco few-shot já formatado (biblioteca de exemplos de treinamento). Vazio
  // quando não há exemplo relevante salvo.
  exemplos?: string;
}): PromptIA {
  const instrucoes = input.instrucoes.trim() || PROMPT_PADRAO;
  const historico = limitarHistorico(input.mensagens, input.maxMensagens ?? MAX_MENSAGENS_CONTEXTO);

  const exemplos = (input.exemplos ?? "").trim();
  const system = [
    instrucoes,
    ...(exemplos ? ["--- Exemplos de treinamento (casos reais da escola) ---", exemplos] : []),
    "--- Situação financeira (Sponte), consultada agora ---",
    blocoFinanceiro(input.financeiro, input.hojeYMD),
  ].join("\n\n");

  const mensagens = historico.map((m) => ({
    role: m.direcao === "in" ? ("user" as const) : ("assistant" as const),
    content: m.automatica
      ? `[mensagem automática de cobrança] ${textoDaMensagem(m)}`
      : textoDaMensagem(m),
  }));

  // A API da Anthropic exige que o primeiro turno seja do usuário e não aceita
  // conversa vazia; histórico que começa pela escola ganha um turno de abertura.
  if (mensagens.length === 0 || mensagens[0].role === "assistant") {
    mensagens.unshift({
      role: "user",
      content: "(sem mensagem anterior do responsável nesta conversa)",
    });
  }

  return { system, mensagens };
}

// Resumo curto do contexto guardado junto da sugestão (o histórico inteiro não é
// duplicado no registro): situação, última fala do responsável e tamanho da conversa.
export function resumirContexto(mensagens: MensagemContexto[]): string {
  const ultima = ultimaDoResponsavel(mensagens);
  const trecho = ultima ? textoDaMensagem(ultima).replace(/\s+/g, " ").slice(0, 280) : "";
  const total = limitarHistorico(mensagens, Number.MAX_SAFE_INTEGER).length;
  const rotulo = LABEL_SITUACAO[classificarSituacao(mensagens)];
  return `${rotulo} · ${total} mensagem(ns) na conversa · última do responsável: ${trecho || "—"}`;
}

export interface RegistroSugestao {
  conversation_id: string;
  aluno_id: string | null;
  unidade: string;
  situacao: SituacaoAtendimento;
  sensivel: boolean;
  motivo_sensivel: string;
  sugestao: string;
  contexto_resumo: string;
  modelo: string;
  tokens_entrada: number;
  tokens_saida: number;
  gerado_por: string;
}

// Linha gravada a cada sugestão gerada (item 7: registro de tudo que a IA
// produziu, com ou sem envio depois).
export function montarRegistroSugestao(input: {
  conversationId: string;
  alunoId: string | null;
  unidade: string;
  mensagens: MensagemContexto[];
  triagem: TriagemSensivel;
  sugestao: string;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  userId: string;
}): RegistroSugestao {
  return {
    conversation_id: input.conversationId,
    aluno_id: input.alunoId || null,
    unidade: input.unidade,
    situacao: classificarSituacao(input.mensagens),
    sensivel: input.triagem.sensivel,
    motivo_sensivel: input.triagem.motivo,
    sugestao: input.sugestao,
    contexto_resumo: resumirContexto(input.mensagens),
    modelo: input.modelo,
    tokens_entrada: input.tokensEntrada,
    tokens_saida: input.tokensSaida,
    gerado_por: input.userId,
  };
}

export interface AtualizacaoEnvio {
  enviado_body: string;
  enviado_em: string;
  editado: boolean;
}

// Fecha o par sugestão/versão-final quando a resposta é enviada a partir de uma
// sugestão. `editado` distingue o envio literal do texto ajustado à mão — é o que
// marca o caso como candidato a exemplo de treinamento.
export function montarAtualizacaoEnvio(
  sugestao: string,
  enviado: string,
  agoraIso: string,
): AtualizacaoEnvio {
  return {
    enviado_body: enviado,
    enviado_em: agoraIso,
    editado: !textosEquivalentes(sugestao, enviado),
  };
}

// Comparação tolerante a espaço/quebra de linha: reindentar não conta como edição.
export function textosEquivalentes(a: string, b: string): boolean {
  const limpar = (t: string) => (t ?? "").replace(/\s+/g, " ").trim();
  return limpar(a) === limpar(b);
}

// Proporção do texto que mudou (0 = idêntico, 1 = reescrito do zero), por
// palavras. Usada para decidir se a edição foi significativa o bastante para
// valer como exemplo de treinamento.
export function grauDeEdicao(sugestao: string, enviado: string): number {
  const palavras = (t: string) =>
    normalizar(t)
      .split(/[^\wçãáéíóúâêôõà]+/i)
      .filter(Boolean);
  const original = palavras(sugestao);
  const final = palavras(enviado);
  if (original.length === 0) return final.length === 0 ? 0 : 1;
  const restantes = new Map<string, number>();
  for (const p of original) restantes.set(p, (restantes.get(p) ?? 0) + 1);
  let mantidas = 0;
  for (const p of final) {
    const n = restantes.get(p) ?? 0;
    if (n > 0) {
      mantidas++;
      restantes.set(p, n - 1);
    }
  }
  const base = Math.max(original.length, final.length);
  return Math.round((1 - mantidas / base) * 100) / 100;
}

// Acima disso a edição é considerada significativa (item 1 da Parte 2).
export const LIMITE_EDICAO_SIGNIFICATIVA = 0.3;

export function edicaoSignificativa(sugestao: string, enviado: string): boolean {
  if (textosEquivalentes(sugestao, enviado)) return false;
  return grauDeEdicao(sugestao, enviado) >= LIMITE_EDICAO_SIGNIFICATIVA;
}

// Competência (YYYY-MM) de um timestamp ISO, no fuso de São Paulo — a Vercel roda
// em UTC, então o contador do mês não pode usar o fuso do processo.
export function competenciaDeIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  });
  return fmt.format(d).slice(0, 7);
}

// Contador de uso do mês (item 9: acompanhar volume, já que a API é paga).
export function contarSugestoesDoMes(
  sugestoes: { gerado_em: string }[],
  competencia: string,
): number {
  return sugestoes.filter((s) => competenciaDeIso(s.gerado_em) === competencia).length;
}
