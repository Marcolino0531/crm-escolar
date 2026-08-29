// Regras puras do portal de Rematrícula (sem I/O, testáveis isoladamente):
//
//  1. Autenticação por código de 6 dígitos enviado no WhatsApp: geração,
//     validade de 10 minutos e bloqueio depois de 3 tentativas erradas.
//  2. Parcelamento do material pedagógico: 1x a 8x, com o ajuste de centavos na
//     primeira parcela para o somatório fechar exatamente o valor anual.
//  3. Identificação da série do aluno a partir da turma do Sponte.
//  4. Vencimentos das parcelas do material: cada parcela vence no mesmo dia da
//     mensalidade daquele mês, ancorada na primeira mensalidade em aberto do ano
//     letivo configurado pela escola.
//
// As funções da fase de homologação (sobra na última parcela, vencimento a
// partir de "hoje", rolagem para o próximo dia útil) seguem no arquivo porque a
// rota temporária de teste as usa até a homologação terminar.
//
// A mensagem devolvida ao responsável é sempre GENÉRICA: o portal é público e
// não pode confirmar se um CPF existe no sistema.

import {
  dataNoMes,
  diaVencimentoHabitual,
  mesSeguinte,
  vencimentoPadraoRecarga,
  type ParcelaAberta,
} from "./cantina";
import { addMesesYMD } from "./confissao-divida";
import { proximoDiaUtil } from "./billing-schedule";

export const CODIGO_DIGITOS = 6;
export const CODIGO_VALIDADE_MINUTOS = 10;
export const MAX_TENTATIVAS_CODIGO = 3;
export const SESSAO_VALIDADE_MINUTOS = 30;

export const MENSAGEM_CODIGO_ENVIADO =
  "Se o CPF informado estiver cadastrado, enviamos um código de 6 dígitos por WhatsApp para o telefone do responsável financeiro. O código vale por 10 minutos.";

export const MENSAGEM_CODIGO_INCORRETO =
  "Código incorreto. Confira os 6 dígitos recebidos no WhatsApp e tente novamente.";

export const MENSAGEM_CODIGO_EXPIRADO =
  "Este código expirou. Solicite um novo código para continuar.";

export const MENSAGEM_BLOQUEADO =
  "Por segurança, o acesso foi bloqueado após 3 tentativas incorretas. Solicite um novo código para tentar de novo.";

export const MENSAGEM_SESSAO_EXPIRADA =
  "Sua sessão expirou. Informe o CPF novamente para receber um novo código.";

// ─── Código de verificação ──────────────────────────────────────────────────

// Gera o código a partir de um sorteio em [0, 1) — o gerador criptográfico fica
// no chamador (server), aqui só entra a formatação de 6 dígitos com zeros à
// esquerda ("004821" é um código válido).
export function gerarCodigoVerificacao(sorteio: number): string {
  const limite = 10 ** CODIGO_DIGITOS;
  const bruto = Math.floor(Math.min(Math.max(sorteio, 0), 0.999999999) * limite);
  return String(bruto).padStart(CODIGO_DIGITOS, "0");
}

export function codigoFormatoValido(codigo: string): boolean {
  return new RegExp(`^\\d{${CODIGO_DIGITOS}}$`).test(codigo.trim());
}

export function expiracaoCodigo(agoraISO: string): string {
  return new Date(Date.parse(agoraISO) + CODIGO_VALIDADE_MINUTOS * 60000).toISOString();
}

export function expiracaoSessao(agoraISO: string): string {
  return new Date(Date.parse(agoraISO) + SESSAO_VALIDADE_MINUTOS * 60000).toISOString();
}

export function sessaoValida(expiraEmISO: string | null, agoraISO: string): boolean {
  return !!expiraEmISO && expiraEmISO > agoraISO;
}

// Estado persistido do desafio de UM CPF (espelha rematricula_codigos).
export interface DesafioCodigo {
  codigoHash: string;
  expiraEm: string | null; // ISO 8601
  tentativas: number;
  bloqueadoAte: string | null; // ISO 8601; null = sem bloqueio
  consumidoEm: string | null;
}

export const DESAFIO_VAZIO: DesafioCodigo = {
  codigoHash: "",
  expiraEm: null,
  tentativas: 0,
  bloqueadoAte: null,
  consumidoEm: null,
};

export type MotivoRecusa = "bloqueado" | "expirado" | "incorreto" | "inexistente";

export interface ResultadoValidacao {
  ok: boolean;
  motivo?: MotivoRecusa;
  mensagem?: string;
  // Estado a ser gravado depois desta tentativa.
  proximo: DesafioCodigo;
}

export function desafioBloqueado(d: DesafioCodigo, agoraISO: string): boolean {
  return d.bloqueadoAte !== null && d.bloqueadoAte > agoraISO;
}

// Valida UMA tentativa. A comparação é feita sobre o HASH do código (o texto
// nunca é guardado), então o chamador passa o hash do que o pai digitou.
// Regras: código já usado ou inexistente e código vencido são recusados sem
// consumir tentativa útil; errar 3 vezes bloqueia o desafio, que só se
// desfaz pedindo um código novo.
export function validarCodigo(
  desafio: DesafioCodigo,
  codigoHashInformado: string,
  agoraISO: string,
): ResultadoValidacao {
  if (desafioBloqueado(desafio, agoraISO)) {
    return { ok: false, motivo: "bloqueado", mensagem: MENSAGEM_BLOQUEADO, proximo: desafio };
  }
  if (!desafio.codigoHash || desafio.consumidoEm) {
    return {
      ok: false,
      motivo: "inexistente",
      mensagem: MENSAGEM_CODIGO_EXPIRADO,
      proximo: desafio,
    };
  }
  if (!desafio.expiraEm || desafio.expiraEm <= agoraISO) {
    return { ok: false, motivo: "expirado", mensagem: MENSAGEM_CODIGO_EXPIRADO, proximo: desafio };
  }
  if (codigoHashInformado !== desafio.codigoHash) {
    const tentativas = desafio.tentativas + 1;
    const bloqueou = tentativas >= MAX_TENTATIVAS_CODIGO;
    return {
      ok: false,
      motivo: bloqueou ? "bloqueado" : "incorreto",
      mensagem: bloqueou ? MENSAGEM_BLOQUEADO : MENSAGEM_CODIGO_INCORRETO,
      proximo: {
        ...desafio,
        tentativas,
        // Bloqueio até a expiração do próprio código: pedir um novo código
        // sobrescreve a linha e devolve as 3 tentativas.
        bloqueadoAte: bloqueou ? desafio.expiraEm : desafio.bloqueadoAte,
      },
    };
  }
  // Acerto: o código é de uso único.
  return {
    ok: true,
    proximo: { ...desafio, tentativas: 0, bloqueadoAte: null, consumidoEm: agoraISO },
  };
}

export function tentativasRestantes(d: DesafioCodigo): number {
  return Math.max(0, MAX_TENTATIVAS_CODIGO - d.tentativas);
}

// ─── Parcelamento do material pedagógico ────────────────────────────────────

export const PARCELAS_MATERIAL_MIN = 1;
export const PARCELAS_MATERIAL_MAX = 8;

export function parcelasMaterialValida(parcelas: number): boolean {
  return (
    Number.isInteger(parcelas) &&
    parcelas >= PARCELAS_MATERIAL_MIN &&
    parcelas <= PARCELAS_MATERIAL_MAX
  );
}

export interface OpcaoParcelamento {
  parcelas: number;
  // Valor das parcelas iguais (todas menos a última).
  valorParcela: number;
  // Última parcela: absorve os centavos da divisão inexata.
  valorUltimaParcela: number;
  total: number;
}

// Divide em centavos para não acumular erro de ponto flutuante: as primeiras
// parcelas ficam com o valor truncado e a ÚLTIMA recebe a diferença, de modo que
// a soma seja exatamente o valor anual (ex.: 1000,00 em 3x → 333,33 + 333,33 +
// 333,34).
export function parcelamentoMaterial(valorAnual: number, parcelas: number): OpcaoParcelamento {
  if (!parcelasMaterialValida(parcelas)) {
    throw new Error("Número de parcelas do material fora do intervalo permitido (1 a 8).");
  }
  const totalCentavos = Math.round(valorAnual * 100);
  const base = Math.floor(totalCentavos / parcelas);
  const ultima = totalCentavos - base * (parcelas - 1);
  return {
    parcelas,
    valorParcela: base / 100,
    valorUltimaParcela: ultima / 100,
    total: totalCentavos / 100,
  };
}

export function opcoesParcelamentoMaterial(valorAnual: number): OpcaoParcelamento[] {
  const opcoes: OpcaoParcelamento[] = [];
  for (let n = PARCELAS_MATERIAL_MIN; n <= PARCELAS_MATERIAL_MAX; n++) {
    opcoes.push(parcelamentoMaterial(valorAnual, n));
  }
  return opcoes;
}

export function formatarBRL(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Rótulo da opção na tela: "3x de R$ 333,33 (última de R$ 333,34)".
export function rotuloParcelamento(op: OpcaoParcelamento): string {
  const base = `${op.parcelas}x de ${formatarBRL(op.valorParcela)}`;
  if (op.parcelas === 1 || op.valorUltimaParcela === op.valorParcela) return base;
  return `${base} (última de ${formatarBRL(op.valorUltimaParcela)})`;
}

// ─── Vencimentos do lançamento do material ──────────────────────────────────

// Categoria financeira do material no plano de contas do Sponte (mesmo nome nas
// quatro unidades).
export const CATEGORIA_MATERIAL_SPONTE = "Material Pedagógico";

// Categorias que não servem de referência para o vencimento do material: o
// próprio material (evita realimentar um lançamento anterior errado), a recarga
// da cantina e as parcelas de acordo, negociadas caso a caso.
const CATEGORIAS_SEM_REFERENCIA = ["material", "cantina", "acordo"];

function semAcento(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function serveDeReferencia(p: ParcelaAberta): boolean {
  const cat = semAcento(p.categoria);
  return p.vencimento !== "" && !CATEGORIAS_SEM_REFERENCIA.some((ign) => cat.includes(ign));
}

export interface VencimentoMaterial {
  vencimento: string; // YYYY-MM-DD
  origem: "mensalidade" | "dia_habitual" | "padrao";
}

// Vencimento da 1ª parcela do material: a data REAL da próxima mensalidade em
// aberto do aluno (a partir de hoje), como na Cantina. Sem mensalidade futura em
// aberto, cai no dia habitual de cobrança do aluno no mês seguinte e, em último
// recurso, no dia 5. A data vinda do Sponte é usada como está (a escola já cobra
// nesse dia); as reconstruídas rolam para o próximo dia útil.
export function primeiroVencimentoMaterial<T extends ParcelaAberta>(
  parcelas: readonly T[],
  hojeYMD: string,
): VencimentoMaterial {
  const proximas = parcelas
    .filter(
      (p) =>
        serveDeReferencia(p) &&
        !p.quitada &&
        Math.round(p.saldo * 100) > 0 &&
        p.vencimento >= hojeYMD,
    )
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  if (proximas.length > 0) return { vencimento: proximas[0].vencimento, origem: "mensalidade" };

  const dia = diaVencimentoHabitual(parcelas);
  if (dia !== null) {
    return {
      vencimento: proximoDiaUtil(dataNoMes(mesSeguinte(hojeYMD), dia)),
      origem: "dia_habitual",
    };
  }
  return { vencimento: proximoDiaUtil(vencimentoPadraoRecarga(hojeYMD)), origem: "padrao" };
}

export interface ParcelaMaterial {
  numero: number;
  valor: number;
  vencimento: string; // YYYY-MM-DD
}

// Cronograma completo do lançamento: valor por parcela (com o ajuste de centavos
// na última, ver parcelamentoMaterial) e vencimento de cada uma — mesmo dia da
// 1ª acrescido de um mês por parcela, empurrando sábado, domingo e feriado
// nacional para o próximo dia útil.
export function parcelasMaterialLancamento(
  valorAnual: number,
  parcelas: number,
  primeiroVencimento: string,
): ParcelaMaterial[] {
  const op = parcelamentoMaterial(valorAnual, parcelas);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiroVencimento)) {
    throw new Error("Vencimento da primeira parcela inválido (esperado YYYY-MM-DD).");
  }
  const itens: ParcelaMaterial[] = [];
  for (let i = 0; i < op.parcelas; i++) {
    itens.push({
      numero: i + 1,
      valor: i === op.parcelas - 1 ? op.valorUltimaParcela : op.valorParcela,
      vencimento: i === 0 ? primeiroVencimento : proximoDiaUtil(addMesesYMD(primeiroVencimento, i)),
    });
  }
  return itens;
}

// Move a sobra de centavos da última parcela para a primeira, replicando o
// "Lançar valor diferenciado para a 1ª parcela" da tela nativa do Sponte
// (R$ 1.000,00 em 3x → 333,34 + 333,33 + 333,33). Com `naPrimeira` falso o
// cronograma volta inalterado (sobra na última).
export function concentrarDiferenca(
  itens: ParcelaMaterial[],
  naPrimeira: boolean,
): ParcelaMaterial[] {
  if (!naPrimeira || itens.length < 2) return itens;
  const centavos = itens.map((p) => Math.round(p.valor * 100));
  const base = centavos[0];
  const sobra = centavos[centavos.length - 1] - base;
  if (sobra === 0) return itens;
  return itens.map((p, i) => ({
    ...p,
    valor: (i === 0 ? base + sobra : base) / 100,
  }));
}

// ─── Fase B: ano letivo de referência, sobra na 1ª parcela e vencimentos ────

export const ANO_LETIVO_MIN = 2024;
export const ANO_LETIVO_MAX = 2100;

export function anoLetivoValido(ano: number): boolean {
  return Number.isInteger(ano) && ano >= ANO_LETIVO_MIN && ano <= ANO_LETIVO_MAX;
}

// Ciclo de vida da escolha do responsável: pendente → efetivada (a secretaria
// reivindicou a linha) → lancada (o título existe no Sponte).
export type StatusEscolhaRematricula = "pendente_lancamento" | "efetivada" | "lancada";

export function observacaoMaterialSponte(anoLetivo: number, parcelas: number): string {
  return `Material pedagógico ${anoLetivo} — rematrícula em ${parcelas}x`;
}

// Parcelamento com a sobra de centavos na PRIMEIRA parcela, como a tela nativa
// do Sponte ("Lançar valor diferenciado para a 1ª parcela"): 1000,00 em 3x →
// 333,34 + 333,33 + 333,33. `valorParcela` é o que vai em nValorParcelas do
// InsertPlano e `valorPrimeiraParcela` é o que o UpdateParcela grava na 1ª.
export interface ParcelamentoPrimeira {
  parcelas: number;
  valorParcela: number;
  valorPrimeiraParcela: number;
  total: number;
}

export function parcelamentoMaterialPrimeira(
  valorAnual: number,
  parcelas: number,
): ParcelamentoPrimeira {
  if (!parcelasMaterialValida(parcelas)) {
    throw new Error("Número de parcelas do material fora do intervalo permitido (1 a 8).");
  }
  const totalCentavos = Math.round(valorAnual * 100);
  const base = Math.floor(totalCentavos / parcelas);
  const primeira = totalCentavos - base * (parcelas - 1);
  return {
    parcelas,
    valorParcela: base / 100,
    valorPrimeiraParcela: primeira / 100,
    total: totalCentavos / 100,
  };
}

export function opcoesParcelamentoMaterialPrimeira(valorAnual: number): ParcelamentoPrimeira[] {
  const opcoes: ParcelamentoPrimeira[] = [];
  for (let n = PARCELAS_MATERIAL_MIN; n <= PARCELAS_MATERIAL_MAX; n++) {
    opcoes.push(parcelamentoMaterialPrimeira(valorAnual, n));
  }
  return opcoes;
}

// Rótulo na tela: "3x de R$ 333,33 (1ª de R$ 333,34)".
export function rotuloParcelamentoPrimeira(op: ParcelamentoPrimeira): string {
  const base = `${op.parcelas}x de ${formatarBRL(op.valorParcela)}`;
  if (op.parcelas === 1 || op.valorPrimeiraParcela === op.valorParcela) return base;
  return `${base} (1ª de ${formatarBRL(op.valorPrimeiraParcela)})`;
}

// Parcelas que representam a MENSALIDADE do aluno. A categoria que carrega a
// mensalidade varia por unidade, então quando existe alguma na categoria
// "Mensalidade" só ela conta; se o aluno não tem nenhuma assim, valem as demais
// parcelas de referência (material, cantina e acordo já ficam de fora).
export function mensalidadesDeReferencia<T extends ParcelaAberta>(
  parcelas: readonly T[],
): T[] {
  const referencia = parcelas.filter(serveDeReferencia);
  const rotuladas = referencia.filter((p) => semAcento(p.categoria).includes("mensalidade"));
  return rotuladas.length > 0 ? rotuladas : referencia;
}

// Âncora do lançamento: a PRIMEIRA mensalidade em aberto do ano letivo
// CONFIGURADO pela escola (não a "próxima em aberto a partir de hoje"). O
// resultado é o mesmo para quem preenche o formulário em agosto/2026 e para quem
// preenche em janeiro/2027, porque a data de hoje não entra na conta.
export function primeiraMensalidadeDoAnoLetivo<T extends ParcelaAberta>(
  parcelas: readonly T[],
  anoLetivo: number,
): T | null {
  const prefixo = `${anoLetivo}-`;
  const doAno = mensalidadesDeReferencia(parcelas)
    .filter(
      (p) => p.vencimento.startsWith(prefixo) && !p.quitada && Math.round(p.saldo * 100) > 0,
    )
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  return doAno[0] ?? null;
}

// Vencimento de cada parcela do material: em cada mês, o MESMO dia da
// mensalidade daquele mês — os dois boletos do mês não podem vencer em datas
// diferentes. Nenhum ajuste de fim de semana ou feriado é feito aqui: a data que
// vale é a que o Sponte já usa na mensalidade (o banco não cobra juros/multa no
// próximo dia útil). Mês sem mensalidade cadastrada mantém o dia da 1ª parcela.
export function vencimentosMaterialPelasMensalidades<T extends ParcelaAberta>(
  mensalidades: readonly T[],
  primeiroVencimento: string,
  parcelas: number,
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiroVencimento)) {
    throw new Error("Vencimento da primeira parcela inválido (esperado YYYY-MM-DD).");
  }
  if (!parcelasMaterialValida(parcelas)) {
    throw new Error("Número de parcelas do material fora do intervalo permitido (1 a 8).");
  }
  const porMes = new Map<string, string>();
  for (const p of mensalidadesDeReferencia(mensalidades)) {
    const mes = p.vencimento.slice(0, 7);
    const atual = porMes.get(mes);
    // Mais de uma mensalidade no mês (parcelamento avulso, rateio): vale a de
    // menor vencimento, a mesma escolhida como âncora.
    if (!atual || p.vencimento < atual) porMes.set(mes, p.vencimento);
  }

  const datas: string[] = [];
  for (let i = 0; i < parcelas; i++) {
    const nominal = addMesesYMD(primeiroVencimento, i);
    datas.push(porMes.get(nominal.slice(0, 7)) ?? nominal);
  }
  return datas;
}

export interface CronogramaMaterial {
  itens: ParcelaMaterial[];
  // Valor comum enviado no InsertPlano (nValorParcelas).
  valorParcela: number;
  // Valor da 1ª parcela depois do UpdateParcela (absorve a sobra de centavos).
  valorPrimeiraParcela: number;
  total: number;
  // Falso quando a divisão é exata: não há sobra para o UpdateParcela corrigir.
  ajustaPrimeira: boolean;
}

// Cronograma final do lançamento do material: valores com sobra na 1ª parcela e
// os vencimentos reais das mensalidades, um por mês.
export function cronogramaMaterialFaseB(
  valorAnual: number,
  parcelas: number,
  vencimentos: readonly string[],
): CronogramaMaterial {
  const op = parcelamentoMaterialPrimeira(valorAnual, parcelas);
  if (vencimentos.length !== op.parcelas) {
    throw new Error("Quantidade de vencimentos diferente do número de parcelas.");
  }
  const itens = vencimentos.map((vencimento, i) => ({
    numero: i + 1,
    valor: i === 0 ? op.valorPrimeiraParcela : op.valorParcela,
    vencimento,
  }));
  return {
    itens,
    valorParcela: op.valorParcela,
    valorPrimeiraParcela: op.valorPrimeiraParcela,
    total: op.total,
    ajustaPrimeira:
      Math.round(op.valorPrimeiraParcela * 100) !== Math.round(op.valorParcela * 100),
  };
}

// ─── Mensalidade vigente e desconto ─────────────────────────────────────────

// Parcela do Sponte reduzida ao que interessa aqui (GetParcelas/wsParcela).
export interface ParcelaMensalidade {
  categoria: string;
  vencimento: string; // YYYY-MM-DD
  valor: number;
  // Campo BolsaAssociada, no formato "Bolsa Funcionário - 30,00%".
  bolsaAssociada: string;
}

export interface MensalidadeVigente {
  valor: number;
  descontoPercentual: number;
  vencimento: string;
  categoria: string;
}

// Percentual de desconto lido do rótulo da bolsa ("... 30,00%" → 30).
export function percentualBolsa(bolsaAssociada: string): number {
  const m = bolsaAssociada.match(/(\d+)[,.]?(\d*)\s*%/);
  if (!m) return 0;
  return parseFloat(`${m[1]}.${m[2] || "0"}`);
}

// Mensalidade VIGENTE = a parcela de mensalidade com o vencimento mais próximo
// ainda por vencer; se o ano já acabou (só parcelas passadas), a mais recente.
// Sempre lida na hora do Sponte — não há cache desse valor em lugar nenhum.
export function mensalidadeVigente(
  parcelas: ParcelaMensalidade[],
  hojeISO: string,
): MensalidadeVigente | null {
  const hoje = hojeISO.slice(0, 10);
  const mensalidades = parcelas.filter(
    (p) => chaveSerie(p.categoria).includes("mensalidade") && p.valor > 0 && p.vencimento,
  );
  if (mensalidades.length === 0) return null;

  const futuras = mensalidades
    .filter((p) => p.vencimento >= hoje)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const escolhida =
    futuras[0] ?? [...mensalidades].sort((a, b) => b.vencimento.localeCompare(a.vencimento))[0];

  return {
    valor: escolhida.valor,
    descontoPercentual: percentualBolsa(escolhida.bolsaAssociada),
    vencimento: escolhida.vencimento,
    categoria: escolhida.categoria,
  };
}

// ─── Série do aluno ─────────────────────────────────────────────────────────

// Chave de comparação da série: sem acento, minúscula, sem espaços repetidos e
// com as variações de ordinal ("1º", "1o", "1ª") unificadas. É ela que casa o
// cadastro digitado pelo administrador com a série lida do Sponte.
export function chaveSerie(serie: string): string {
  return serie
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ºª°]/g, "")
    .replace(/(\d)\s*o\b/gi, "$1")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

// Série a partir da turma do Sponte (campo TurmaAtual): a turma traz o
// identificador da turma e, às vezes, turno ("3º Ano A - Manhã", "Maternal II B").
// A série é o trecho antes do separador, sem a letra final que identifica a
// turma.
export function serieDaTurma(turma: string): string {
  const semTurno = turma.split(/[-–—/(]/)[0].trim();
  const partes = semTurno.split(/\s+/).filter(Boolean);
  if (partes.length > 1) {
    const ultima = partes[partes.length - 1];
    // Letra isolada no fim = identificador da turma ("3º Ano A"); numeral
    // romano ("Maternal II") faz parte do nome da série.
    if (/^[A-Za-z]$/.test(ultima)) partes.pop();
  }
  return partes.join(" ");
}
