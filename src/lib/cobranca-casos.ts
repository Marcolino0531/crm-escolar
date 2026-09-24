// Régua MANUAL de cobrança por responsável financeiro — lógica pura (sem
// Supabase nem Sponte), compartilhada entre servidor, tela, notificação
// extrajudicial, demonstrativo e dossiê.
//
// Regra monetária: SEMPRE `valorAtualizadoParcela` de billing-debt (multa 2%
// única + juros 1% ao mês pró rata die). Nada aqui recalcula juros por conta.

import {
  diasEntreYMD,
  JUROS_MORA_MES,
  MULTA_ATRASO,
  parcelasVencidas,
  valorAtualizadoParcela,
  type ParcelaAberta,
} from "@/lib/billing-debt";
import { isDiaUtilDespesa } from "@/lib/fluxo-futuro-dia-util";

// ─── Catálogos ───────────────────────────────────────────────────────────────

export const STATUS_CASO = [
  "mensagens",
  "notificacao",
  "aguardando_prazo",
  "processo",
  "encerrado",
] as const;
export type StatusCaso = (typeof STATUS_CASO)[number];

/** Etapa exibida na tela: o status mais o derivado "pronto_processo". */
export type EtapaCaso = StatusCaso | "pronto_processo";

export const ETAPAS_FILTRO: readonly { id: EtapaCaso; label: string }[] = [
  { id: "mensagens", label: "Mensagens" },
  { id: "notificacao", label: "Notificação" },
  { id: "aguardando_prazo", label: "Aguardando prazo" },
  { id: "pronto_processo", label: "Pronto para processo" },
  { id: "processo", label: "Em processo" },
  { id: "encerrado", label: "Encerradas" },
];

export const MOTIVOS_ENCERRAMENTO = [
  { id: "pago", label: "Pago" },
  { id: "acordo", label: "Acordo" },
  { id: "extinto", label: "Extinto" },
  { id: "incobravel", label: "Incobrável" },
  { id: "outro", label: "Outro" },
] as const;
export type MotivoEncerramento = (typeof MOTIVOS_ENCERRAMENTO)[number]["id"];

export const CATEGORIAS_ANEXO = [
  "notificacao_enviada",
  "print_notificacao",
  "contrato",
  "ficha_matricula",
  "demonstrativo",
  "prestacao_servico",
  "transferencia",
  "docs_responsavel",
  "outro",
] as const;
export type CategoriaAnexo = (typeof CATEGORIAS_ANEXO)[number];

/** Checklist de documentação para o processo (nenhum item obrigatório). */
export const CHECKLIST_DOCUMENTACAO: readonly {
  categoria: CategoriaAnexo;
  label: string;
  descricao: string;
  gerado?: boolean;
  multiplos?: boolean;
}[] = [
  {
    categoria: "contrato",
    label: "Contrato de prestação de serviços educacionais assinado",
    descricao: "Contrato do ano letivo, assinado pelo responsável.",
  },
  { categoria: "ficha_matricula", label: "Ficha de matrícula", descricao: "Ficha do aluno." },
  {
    categoria: "demonstrativo",
    label: "Demonstrativo do débito atualizado",
    descricao: "Gerado pelo sistema com as parcelas em aberto atuais do Sponte.",
    gerado: true,
  },
  {
    categoria: "prestacao_servico",
    label: "Comprovação da prestação do serviço",
    descricao: "Histórico escolar, declaração de frequência.",
  },
  {
    categoria: "transferencia",
    label: "Pedido de transferência (se houver)",
    descricao: "Solicitação de transferência do aluno.",
  },
  {
    categoria: "docs_responsavel",
    label: "Documentos do responsável",
    descricao: "RG ou CNH, CPF, comprovante de endereço.",
  },
  {
    categoria: "outro",
    label: "Outros",
    descricao: "Nome livre; pode ter vários arquivos.",
    multiplos: true,
  },
];

export const LABEL_CATEGORIA: Record<CategoriaAnexo, string> = {
  notificacao_enviada: "Notificação extrajudicial enviada",
  print_notificacao: "Print do envio da notificação",
  contrato: "Contrato",
  ficha_matricula: "Ficha de matrícula",
  demonstrativo: "Demonstrativo do débito",
  prestacao_servico: "Comprovação da prestação do serviço",
  transferencia: "Pedido de transferência",
  docs_responsavel: "Documentos do responsável",
  outro: "Outro",
};

export const BUCKET_COBRANCA = "cobranca-casos";
export const TOTAL_MENSAGENS = 5;
export const PRAZO_NOTIFICACAO_DIAS = 10;
export const TAMANHO_MAX_ANEXO = 10 * 1024 * 1024;
export const TIPOS_ANEXO_ACEITOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface AlunoCaso {
  aluno_id: string;
  nome: string;
}

export interface EnderecoResponsavel {
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
}

/** Uma parcela vencida, atualizada para a data-base. */
export interface ParcelaDebito {
  aluno_id: string;
  aluno: string;
  descricao: string;
  vencimento: string; // YYYY-MM-DD
  original: number;
  dias_atraso: number;
  multa: number;
  juros: number;
  atualizado: number;
}

export interface DemonstrativoDebito {
  dataBase: string;
  parcelas: ParcelaDebito[];
  total: number;
}

/** Parcela em aberto de um aluno como vem do Sponte (boleto agrupado). */
export interface ParcelaAbertaAluno extends ParcelaAberta {
  alunoId: string;
  alunoNome: string;
  descricao: string;
}

export interface CasoResumo {
  id: string;
  unidade: string;
  responsavel_nome: string;
  responsavel_cpf: string | null;
  alunos: AlunoCaso[];
  valor_inicial: number;
  status: StatusCaso;
  /** Data-base da cobrança (YYYY-MM-DD), informada e editável até o 1º print. */
  data_inicio: string;
  /** Auditoria: quando o caso foi lançado no sistema. */
  iniciado_em: string;
  prazo_final: string | null;
  notificacao_gerada_em: string | null;
  notificacao_recebida_em: string | null;
}

export interface MensagemCaso {
  id: string;
  caso_id: string;
  ordem: number;
  data_prevista: string;
  /** Data real do envio (YYYY-MM-DD), informada ao registrar. */
  data_envio: string | null;
  /** Auditoria: quando o envio foi registrado no sistema. */
  enviada_em: string | null;
  enviada_por: string | null;
  print_path: string | null;
  fora_da_data: boolean;
  print_historico: SubstituicaoPrint[];
}

export interface SubstituicaoPrint {
  em: string;
  por: string;
  data_envio_de: string | null;
  data_envio_para: string | null;
}

export interface AnexoCaso {
  id: string;
  caso_id: string;
  categoria: CategoriaAnexo;
  nome_personalizado: string | null;
  storage_path: string;
  nome_arquivo: string;
  tipo_arquivo: string;
  tamanho_bytes: number;
  origem: "upload" | "sistema" | "gerado";
  created_by: string | null;
  created_at: string;
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

export function arredondar2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function somenteDigitos(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

export function normalizarNome(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Chave única do responsável na unidade: CPF só dígitos; sem CPF, nome normalizado. */
export function responsavelKey(cpf: string, nome: string): string {
  const d = somenteDigitos(cpf);
  return d.length > 0 ? d : `nome:${normalizarNome(nome)}`;
}

export function addDiasYMD(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

// ─── Débito ──────────────────────────────────────────────────────────────────

/**
 * Atualiza UMA parcela para a data-base pela regra oficial (billing-debt),
 * decompondo multa e juros só para exibição. `atualizado` é o resultado de
 * `valorAtualizadoParcela` arredondado a 2 casas; multa e juros são
 * arredondados separadamente e a diferença de centavo (se houver) fica nos juros
 * para que original + multa + juros == atualizado em cada linha.
 */
export function atualizarParcela(p: ParcelaAbertaAluno, dataBaseYMD: string): ParcelaDebito {
  const original = arredondar2(p.saldo);
  const atualizado = arredondar2(valorAtualizadoParcela(original, p.vencimento, dataBaseYMD));
  const dias = Math.max(0, diasEntreYMD(p.vencimento, dataBaseYMD));
  const multa = dias > 0 ? arredondar2(original * MULTA_ATRASO) : 0;
  const juros = arredondar2(atualizado - original - multa);
  return {
    aluno_id: p.alunoId,
    aluno: p.alunoNome,
    descricao: p.descricao,
    vencimento: p.vencimento,
    original,
    dias_atraso: dias,
    multa,
    juros,
    atualizado,
  };
}

/**
 * Demonstrativo/snapshot: só as parcelas VENCIDAS na data-base (regra de
 * `parcelasVencidas`), de todos os alunos do responsável, ordenadas por
 * vencimento e aluno. O total é a soma das linhas já arredondadas — nunca há
 * diferença de centavos entre tabela e total.
 */
export function montarDemonstrativo(
  parcelas: readonly ParcelaAbertaAluno[],
  dataBaseYMD: string,
): DemonstrativoDebito {
  const vencidas = parcelasVencidas([...parcelas], dataBaseYMD)
    .map((p) => atualizarParcela(p, dataBaseYMD))
    .sort(
      (a, b) =>
        a.vencimento.localeCompare(b.vencimento) ||
        a.aluno.localeCompare(b.aluno) ||
        a.descricao.localeCompare(b.descricao),
    );
  const total = arredondar2(vencidas.reduce((s, p) => s + p.atualizado, 0));
  return { dataBase: dataBaseYMD, parcelas: vencidas, total };
}

export function totalDemonstrativo(parcelas: readonly ParcelaDebito[]): number {
  return arredondar2(parcelas.reduce((s, p) => s + p.atualizado, 0));
}

/** Texto da regra de cálculo impresso no rodapé do demonstrativo/notificação. */
export const NOTA_REGRA_CALCULO = `Valores atualizados conforme o contrato: multa de ${(
  MULTA_ATRASO * 100
).toFixed(0)}% sobre a parcela vencida (uma única vez) e juros de mora de ${(
  JUROS_MORA_MES * 100
).toFixed(0)}% ao mês, proporcionais aos dias de atraso (pró rata die).`;

// ─── Datas da régua ──────────────────────────────────────────────────────────

/**
 * Datas previstas das 5 mensagens: o dia do início (se dia útil; senão o
 * próximo dia útil) e os 4 dias úteis seguintes, por `isDiaUtilDespesa`.
 * Ex.: qua 23/09/2026 → 23/09, 24/09, 25/09, 28/09, 29/09.
 */
export function datasMensagens(inicioYMD: string, total = TOTAL_MENSAGENS): string[] {
  const datas: string[] = [];
  let d = inicioYMD;
  while (datas.length < total) {
    if (isDiaUtilDespesa(d)) datas.push(d);
    d = addDiasYMD(d, 1);
  }
  return datas;
}

function proximoDiaUtilAPartir(ymd: string): string {
  let d = ymd;
  while (!isDiaUtilDespesa(d)) d = addDiasYMD(d, 1);
  return d;
}

export interface MudancaPrevista {
  ordem: number;
  de: string;
  para: string;
}

/**
 * Reagendamento das mensagens não registradas: se a primeira pendente tem
 * data prevista anterior a hoje, ela passa para hoje (ou o próximo dia útil) e
 * cada pendente seguinte para o dia útil seguinte ao da anterior. Mensagens já
 * registradas nunca mudam. Idempotente: sem pendente atrasada, retorna [].
 */
export function reagendarMensagens(
  mensagens: readonly Pick<MensagemCaso, "ordem" | "data_prevista" | "enviada_em">[],
  hojeYMD: string,
): MudancaPrevista[] {
  const pendentes = [...mensagens].filter((m) => !m.enviada_em).sort((a, b) => a.ordem - b.ordem);
  if (pendentes.length === 0 || pendentes[0].data_prevista >= hojeYMD) return [];
  const mudancas: MudancaPrevista[] = [];
  let data = proximoDiaUtilAPartir(hojeYMD);
  for (const m of pendentes) {
    if (m.data_prevista !== data)
      mudancas.push({ ordem: m.ordem, de: m.data_prevista, para: data });
    data = proximoDiaUtilAPartir(addDiasYMD(data, 1));
  }
  return mudancas;
}

/** Ordem da mensagem prevista para hoje e ainda sem registro (null se não houver). */
export function mensagemDoDiaPendente(
  caso: Pick<CasoResumo, "status">,
  mensagens: readonly Pick<MensagemCaso, "ordem" | "data_prevista" | "enviada_em">[],
  hojeYMD: string,
): number | null {
  if (caso.status !== "mensagens") return null;
  const m = mensagens.find((x) => !x.enviada_em && x.data_prevista === hojeYMD);
  return m ? m.ordem : null;
}

/** Texto do evento de reagendamento: "Mensagens 4 a 5 reagendadas: mensagem 4 de 23/09 para 24/09; ...". */
export function descreverReagendamento(mudancas: readonly MudancaPrevista[]): string {
  const ordens = mudancas.map((m) => m.ordem);
  const de = Math.min(...ordens);
  const ate = Math.max(...ordens);
  const cabecalho =
    de === ate ? `Mensagem ${de} reagendada` : `Mensagens ${de} a ${ate} reagendadas`;
  const ddmm = (ymd: string) => formatarDataBR(ymd).slice(0, 5);
  return `${cabecalho}: ${mudancas
    .map((m) => `mensagem ${m.ordem} de ${ddmm(m.de)} para ${ddmm(m.para)}`)
    .join("; ")}`;
}

/** Data de início: obrigatória, YYYY-MM-DD válida e não futura. */
export function validarDataInicio(dataInicioYMD: string, hojeYMD: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicioYMD)) return "Informe a data de início da cobrança.";
  if (dataInicioYMD > hojeYMD) return "A data de início não pode ser futura.";
  return null;
}

/**
 * Data real do envio: não futura, não anterior ao início do caso e não anterior
 * ao envio da mensagem anterior.
 */
export function validarDataEnvio(
  dataEnvioYMD: string,
  hojeYMD: string,
  dataInicioYMD: string,
  dataEnvioAnteriorYMD: string | null,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEnvioYMD)) return "Informe a data do envio.";
  if (dataEnvioYMD > hojeYMD) return "A data do envio não pode ser futura.";
  if (dataEnvioYMD < dataInicioYMD)
    return `A data do envio não pode ser anterior ao início da cobrança (${formatarDataBR(dataInicioYMD)}).`;
  if (dataEnvioAnteriorYMD && dataEnvioYMD < dataEnvioAnteriorYMD)
    return `A data do envio não pode ser anterior à da mensagem anterior (${formatarDataBR(dataEnvioAnteriorYMD)}).`;
  return null;
}

/** Substituir o print: só em mensagem já registrada e com o caso ainda não encerrado. */
export function podeSubstituirPrint(
  caso: Pick<CasoResumo, "status">,
  mensagem: Pick<MensagemCaso, "print_path">,
): boolean {
  return caso.status !== "encerrado" && !!mensagem.print_path;
}

/** A data do envio só pode ser corrigida antes da notificação extrajudicial (status 'mensagens'). */
export function podeCorrigirDataEnvio(caso: Pick<CasoResumo, "status">): boolean {
  return caso.status === "mensagens";
}

/**
 * Correção da data do envio de mensagem já registrada: mesmas regras do registro e,
 * se houver mensagem seguinte já enviada, não posterior à data de envio dela.
 */
export function validarDataEnvioCorrigida(
  dataEnvioYMD: string,
  hojeYMD: string,
  dataInicioYMD: string,
  dataEnvioAnteriorYMD: string | null,
  dataEnvioSeguinteYMD: string | null,
): string | null {
  const base = validarDataEnvio(dataEnvioYMD, hojeYMD, dataInicioYMD, dataEnvioAnteriorYMD);
  if (base) return base;
  if (dataEnvioSeguinteYMD && dataEnvioYMD > dataEnvioSeguinteYMD)
    return `A data do envio não pode ser posterior à da mensagem seguinte (${formatarDataBR(dataEnvioSeguinteYMD)}).`;
  return null;
}

/** Sugestão de data do envio: a prevista, se já passou; senão hoje. */
export function dataEnvioSugerida(dataPrevistaYMD: string, hojeYMD: string): string {
  return dataPrevistaYMD < hojeYMD ? dataPrevistaYMD : hojeYMD;
}

/** A data de início só pode mudar enquanto nenhuma mensagem tiver print registrado. */
export function podeAlterarDataInicio(
  caso: Pick<CasoResumo, "status">,
  mensagens: readonly Pick<MensagemCaso, "print_path">[],
): boolean {
  return caso.status === "mensagens" && mensagens.every((m) => !m.print_path);
}

export function prazoFinalNotificacao(recebimentoYMD: string): string {
  return addDiasYMD(recebimentoYMD, PRAZO_NOTIFICACAO_DIAS);
}

/** Dias restantes do prazo (negativo quando já venceu). */
export function diasRestantesPrazo(prazoFinalYMD: string, hojeYMD: string): number {
  return diasEntreYMD(hojeYMD, prazoFinalYMD);
}

// ─── Etapas ──────────────────────────────────────────────────────────────────

/** "Pronto para processo" = aguardando_prazo e hoje > prazo_final. */
export function etapaDoCaso(
  caso: Pick<CasoResumo, "status" | "prazo_final">,
  hojeYMD: string,
): EtapaCaso {
  if (caso.status === "aguardando_prazo" && caso.prazo_final && hojeYMD > caso.prazo_final)
    return "pronto_processo";
  return caso.status;
}

export function labelEtapa(etapa: EtapaCaso): string {
  return ETAPAS_FILTRO.find((e) => e.id === etapa)?.label ?? etapa;
}

export function proximaAcao(
  caso: Pick<CasoResumo, "status" | "prazo_final" | "notificacao_gerada_em">,
  mensagens: readonly Pick<MensagemCaso, "ordem" | "enviada_em">[],
  hojeYMD: string,
): string {
  const etapa = etapaDoCaso(caso, hojeYMD);
  switch (etapa) {
    case "mensagens": {
      const pendente = [...mensagens].sort((a, b) => a.ordem - b.ordem).find((m) => !m.enviada_em);
      return pendente
        ? `Registrar envio da mensagem ${pendente.ordem}/${TOTAL_MENSAGENS}`
        : "Gerar notificação extrajudicial";
    }
    case "notificacao":
      return caso.notificacao_gerada_em
        ? "Registrar envio da notificação"
        : "Gerar notificação extrajudicial";
    case "aguardando_prazo": {
      const dias = caso.prazo_final ? diasRestantesPrazo(caso.prazo_final, hojeYMD) : 0;
      return dias === 0 ? "Prazo termina hoje" : `Aguardar prazo (${dias} dia(s))`;
    }
    case "pronto_processo":
      return "Iniciar processo judicial";
    case "processo":
      return "Acompanhar processo";
    case "encerrado":
      return "Caso encerrado";
  }
}

/** Mensagem N só depois da N-1 e com print obrigatório. */
export function validarRegistroMensagem(
  mensagens: readonly Pick<MensagemCaso, "ordem" | "enviada_em">[],
  ordem: number,
  temPrint: boolean,
): string | null {
  if (!temPrint) return "Envie o print da mensagem para registrar o envio.";
  const alvo = mensagens.find((m) => m.ordem === ordem);
  if (!alvo) return "Mensagem não encontrada.";
  if (alvo.enviada_em) return "Esta mensagem já foi registrada.";
  const anterior = mensagens.find((m) => m.ordem === ordem - 1);
  if (ordem > 1 && !anterior?.enviada_em)
    return `Registre primeiro a mensagem ${ordem - 1}/${TOTAL_MENSAGENS}.`;
  return null;
}

export function validarEncerramento(motivo: string, observacao: string): string | null {
  if (!MOTIVOS_ENCERRAMENTO.some((m) => m.id === motivo))
    return "Escolha o motivo do encerramento.";
  if (motivo === "outro" && !observacao.trim()) return "Descreva o motivo em Observação.";
  return null;
}

export function validarArquivoAnexo(tipo: string, tamanho: number): string | null {
  if (!(TIPOS_ANEXO_ACEITOS as readonly string[]).includes(tipo))
    return "Envie PDF, JPG, PNG, WEBP ou HEIC.";
  if (tamanho > TAMANHO_MAX_ANEXO) return "Arquivo acima de 10 MB.";
  return null;
}

// ─── Linha do tempo ──────────────────────────────────────────────────────────

export type TipoEvento =
  | "inicio"
  | "mensagem"
  | "notificacao_gerada"
  | "notificacao_enviada"
  | "fim_prazo"
  | "documento"
  | "processo"
  | "andamento"
  | "prazo"
  | "recebimento"
  | "encerramento";

export interface EventoTimeline {
  tipo: TipoEvento;
  /** ISO (timestamp) ou YYYY-MM-DD — usado só para ordenar. */
  quando: string;
  titulo: string;
  detalhe?: string;
  anexo?: AnexoCaso;
  mensagem?: MensagemCaso;
  futuro?: boolean;
}

export interface AlteracaoDataInicio {
  de: string;
  para: string;
  em: string;
  por: string;
}

export interface ReagendamentoMensagens {
  tipo: "reagendamento";
  em: string;
  mudancas: MudancaPrevista[];
}

/** Histórico do caso gravado em `cobranca_casos.data_inicio_historico` (jsonb). */
export type HistoricoCaso = AlteracaoDataInicio | ReagendamentoMensagens;

export function isReagendamento(h: HistoricoCaso): h is ReagendamentoMensagens {
  return "tipo" in h && h.tipo === "reagendamento";
}

export interface CasoCompleto extends CasoResumo {
  data_inicio_historico: HistoricoCaso[];
  responsavel_telefone: string | null;
  responsavel_email: string | null;
  responsavel_endereco: EnderecoResponsavel | null;
  debito_inicial: ParcelaDebito[];
  iniciado_por: string;
  documentacao_concluida: CategoriaAnexo[];
  encerrado_em: string | null;
  encerrado_por: string | null;
  motivo_encerramento: MotivoEncerramento | null;
  observacao_encerramento: string | null;
}

export function chaveOrdem(quando: string): string {
  // Datas puras ordenam como fim do dia, para "fim do prazo" ficar depois dos
  // eventos daquele dia.
  return quando.length === 10 ? `${quando}T23:59:59.999Z` : quando;
}

/** Linha do tempo única em ordem de data (passado e previsto). */
export function montarTimeline(
  caso: CasoCompleto,
  mensagens: readonly MensagemCaso[],
  anexos: readonly AnexoCaso[],
  hojeYMD: string,
): EventoTimeline[] {
  const eventos: EventoTimeline[] = [];
  eventos.push({
    tipo: "inicio",
    quando: caso.data_inicio,
    titulo: "Cobrança iniciada",
    detalhe: `${caso.alunos.length} aluno(s) · valor inicial ${formatarBRL(caso.valor_inicial)}`,
  });
  for (const alt of caso.data_inicio_historico ?? [])
    eventos.push(
      isReagendamento(alt)
        ? { tipo: "mensagem", quando: alt.em, titulo: descreverReagendamento(alt.mudancas) }
        : {
            tipo: "inicio",
            quando: alt.em,
            titulo: `Data de início alterada de ${formatarDataBR(alt.de)} para ${formatarDataBR(alt.para)}`,
          },
    );
  for (const m of [...mensagens].sort((a, b) => a.ordem - b.ordem)) {
    eventos.push({
      tipo: "mensagem",
      quando: m.data_envio ?? m.data_prevista,
      titulo: `Mensagem ${m.ordem}/${TOTAL_MENSAGENS}`,
      detalhe: m.enviada_em
        ? m.fora_da_data
          ? "Enviada fora da data prevista"
          : "Enviada na data prevista"
        : `Prevista para ${formatarDataBR(m.data_prevista)}`,
      mensagem: m,
      futuro: !m.enviada_em,
    });
    for (const s of m.print_historico ?? [])
      eventos.push({
        tipo: "mensagem",
        quando: s.em,
        titulo: `Print da mensagem ${m.ordem} substituído`,
        detalhe:
          s.data_envio_de && s.data_envio_para && s.data_envio_de !== s.data_envio_para
            ? `Data do envio corrigida de ${formatarDataBR(s.data_envio_de)} para ${formatarDataBR(s.data_envio_para)}`
            : undefined,
      });
  }
  if (caso.notificacao_gerada_em)
    eventos.push({
      tipo: "notificacao_gerada",
      quando: caso.notificacao_gerada_em,
      titulo: "Notificação extrajudicial gerada",
    });
  if (caso.notificacao_recebida_em)
    eventos.push({
      tipo: "notificacao_enviada",
      quando: caso.notificacao_recebida_em,
      titulo: "Notificação enviada e recebida",
      detalhe: `Recebida em ${formatarDataBR(caso.notificacao_recebida_em)}`,
    });
  if (caso.prazo_final)
    eventos.push({
      tipo: "fim_prazo",
      quando: caso.prazo_final,
      titulo: "Fim do prazo de 10 dias",
      detalhe:
        hojeYMD > caso.prazo_final
          ? "Prazo encerrado — pronto para processo"
          : `${diasRestantesPrazo(caso.prazo_final, hojeYMD)} dia(s) restante(s)`,
      futuro: hojeYMD <= caso.prazo_final,
    });
  for (const a of anexos) {
    // Prints das mensagens já aparecem dentro da própria mensagem.
    eventos.push({
      tipo: "documento",
      quando: a.created_at,
      titulo: a.nome_personalizado || LABEL_CATEGORIA[a.categoria],
      detalhe:
        a.origem === "gerado"
          ? "Gerado pelo sistema"
          : a.origem === "sistema"
            ? a.categoria === "contrato"
              ? "Contrato assinado buscado no sistema (ZapSign)"
              : "Copiado do cadastro de matrícula"
            : a.nome_arquivo,
      anexo: a,
    });
  }
  if (caso.encerrado_em)
    eventos.push({
      tipo: "encerramento",
      quando: caso.encerrado_em,
      titulo: "Cobrança encerrada",
      detalhe: [
        MOTIVOS_ENCERRAMENTO.find((m) => m.id === caso.motivo_encerramento)?.label,
        caso.observacao_encerramento,
      ]
        .filter(Boolean)
        .join(" — "),
    });
  return eventos.sort((a, b) => chaveOrdem(a.quando).localeCompare(chaveOrdem(b.quando)));
}

// ─── Formatação ──────────────────────────────────────────────────────────────

export function formatarBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatarDataBR(ymd: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function formatarCpf(cpf: string | null | undefined): string {
  const d = somenteDigitos(cpf ?? "");
  if (d.length !== 11) return cpf ?? "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function enderecoResponsavelLinha(e: EnderecoResponsavel | null | undefined): string {
  if (!e) return "";
  const rua = [e.endereco, e.numero].filter(Boolean).join(", ");
  const partes = [
    [rua, e.complemento].filter(Boolean).join(" - "),
    e.bairro,
    [e.cidade, e.estado].filter(Boolean).join("/"),
    e.cep ? `CEP ${e.cep}` : "",
  ].filter(Boolean);
  return partes.join(", ");
}

// ─── Contrato assinado (Buscar no sistema) ───────────────────────────────────

/** Trava fixa: só contratos deste ano letivo em diante entram na Cobrança. */
export const ANO_LETIVO_MINIMO_CONTRATO = 2027;

export interface ContratoAssinadoDisponivel {
  contratoId: string;
  alunoNome: string;
  anoLetivo: number;
  numeroContrato: string;
  assinadoEm: string | null;
  jaAnexado: boolean;
}

export function nomeAnexoContrato(anoLetivo: number, alunoNome: string, numero: string): string {
  return `Contrato ${anoLetivo} - ${alunoNome} - ${numero}`;
}

export function contratoElegivelCobranca(
  c: {
    unidade: string;
    aluno_id: string;
    ano_letivo: number;
    status: string;
  },
  caso: Pick<CasoResumo, "unidade" | "alunos">,
): boolean {
  return (
    c.unidade === caso.unidade &&
    c.ano_letivo >= ANO_LETIVO_MINIMO_CONTRATO &&
    c.status !== "cancelado" &&
    caso.alunos.some((a) => a.aluno_id === c.aluno_id)
  );
}
