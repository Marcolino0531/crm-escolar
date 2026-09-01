// Lógica pura da folha de ponto mensal (RH).
//
// Fonte de dados própria, independente do ranking de faltas (que é lançamento
// manual): aqui o insumo é o PDF mensal do relógio de ponto, uma página por
// funcionário. Este módulo cobre a parte determinística — reconstruir as linhas
// da página a partir dos itens do pdfjs, interpretar os dois layouts reais em
// uso nas unidades, casar cada página com o funcionário cadastrado e calcular
// atraso e saída antecipada contra o horário do cadastro.
//
// A leitura do arquivo em si está em `ponto.pdf.ts` (client, pdfjs) e a
// persistência do histórico em `ponto.functions.ts`.

import { identificarFuncionarioDaPagina, normalizarTexto, somenteDigitos } from "./contracheques";

// Item de texto do pdfjs já reduzido ao que interessa: conteúdo e posição.
export type ItemPonto = { texto: string; x: number; y: number };

// Itens na mesma altura da página formam uma linha. `x` importa porque nos dois
// layouts as marcações do relógio e as colunas de totalização (H. Trab., H.
// Extra) são ambas "HH:MM" — só a posição na página distingue uma da outra.
export type LinhaPonto = { y: number; itens: ItemPonto[]; texto: string };

export type LayoutPonto = "cartao_ponto" | "iponto";

// Limiar em minutos a partir do qual a diferença conta: entrada 5 minutos ou
// mais depois do horário é atraso; saída 5 minutos ou mais antes é saída
// antecipada. Chegar cedo e sair depois nunca contam.
export const LIMIAR_PADRAO_MIN = 5;

export type DiaPonto = {
  data: string; // DD/MM
  marcacoes: string[]; // batidas do dia, em ordem cronológica
  rotulos: string[]; // Folga, Férias, Falta, DSR, DUNT, Atestado…
  previsto: { entrada: string; saida: string } | null; // horário impresso no PDF
};

export type PaginaPonto = {
  pagina: number;
  nome: string;
  cpf: string;
  dias: DiaPonto[];
};

export type HorarioEsperado = { entrada: string; saida: string };

export type FuncionarioPonto = {
  id: string;
  nomeCompleto: string;
  cpf: string;
  unidade: string;
  ativo: boolean;
  horarioInicio: string;
  horarioFim: string;
};

const RE_HORA = /^(\d{1,2}):(\d{2})$/;
const RE_HORA_G = /\b(\d{1,2}:\d{2})\b/g;

// Rótulos que o relógio imprime no lugar das batidas. Não são dia de trabalho
// normal e ficam fora dos rankings.
const ROTULOS = [
  "FOLGA",
  "FERIAS",
  "FALTA",
  "ATESTADO",
  "ATESTAD",
  "DSR",
  "DUNT",
  "FERIADO",
  "AFASTAMENTO",
  "LICENCA",
  "COMPENSADO",
];

export function minutosDoHorario(valor: string): number | null {
  const m = RE_HORA.exec((valor ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatarMinutos(total: number): string {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

// Reconstrói as linhas da página a partir dos itens soltos do pdfjs. Aceita
// `unknown` de propósito: quando a lib devolve algo fora do contrato, a página
// vira "sem texto" em vez de derrubar a leitura do arquivo inteiro.
export function linhasDeItens(itens: unknown): LinhaPonto[] {
  if (!Array.isArray(itens)) return [];

  const brutos: ItemPonto[] = [];
  for (const item of itens) {
    if (typeof item !== "object" || item === null) continue;
    const it = item as { str?: unknown; transform?: unknown };
    if (typeof it.str !== "string") continue;
    const texto = it.str.trim();
    if (!texto) continue;
    const transform = it.transform;
    if (!Array.isArray(transform)) continue;
    const x = transform[4];
    const y = transform[5];
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (typeof y !== "number" || !Number.isFinite(y)) continue;
    brutos.push({ texto, x: Math.round(x), y: Math.round(y) });
  }

  const linhas: LinhaPonto[] = [];
  for (const item of brutos) {
    const linha = linhas.find((l) => Math.abs(l.y - item.y) <= 2);
    if (linha) linha.itens.push(item);
    else linhas.push({ y: item.y, itens: [item], texto: "" });
  }

  for (const linha of linhas) {
    linha.itens.sort((a, b) => a.x - b.x);
    linha.texto = linha.itens.map((i) => i.texto).join(" ");
  }
  return linhas.sort((a, b) => b.y - a.y);
}

export function textoDaPagina(linhas: readonly LinhaPonto[]): string {
  return linhas.map((l) => l.texto).join("\n");
}

export function detectarLayout(linhas: readonly LinhaPonto[]): LayoutPonto | null {
  const texto = normalizarTexto(textoDaPagina(linhas));
  if (texto.includes("NOME DO FUNCIONARIO") && texto.includes("PREVISTO")) return "cartao_ponto";
  if (texto.includes("CARTAO DE PONTO CALCULADO") || texto.includes("HORARIO DE TRABALHO")) {
    return "iponto";
  }
  return null;
}

function rotulosDe(textos: readonly string[]): string[] {
  const achados: string[] = [];
  for (const t of textos) {
    const norm = normalizarTexto(t);
    const rotulo = ROTULOS.find((r) => norm === r || norm.startsWith(`${r} `));
    if (rotulo && !achados.includes(rotulo)) achados.push(rotulo);
  }
  return achados;
}

// ---------- Layout A: "Cartão de Ponto" (coletor iDFace) ----------
//
// Uma linha por dia, com o previsto impresso na própria linha
// ("07:00-11:30 13:00-17:30") e cada batida sufixada pela origem — "08:00 (C)".
// O sufixo é o que separa batida de coluna de totalização.

const RE_DIA_A = /^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*[A-ZÇ]{3}$/;
const RE_MARCACAO_A = /\b(\d{1,2}:\d{2})\s*\([A-Z]\)/g;
const RE_PREVISTO = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g;

// O nome pode terminar na própria linha, no campo seguinte ou colado no
// cabeçalho da grade de horários ("… ENT. 1 SAÍ. 1 ENT. 2 SAÍ. 2"), porque os
// dois blocos são impressos na mesma altura da página.
const RE_NOME_A =
  /NOME DO FUNCION[ÁA]RIO:\s*(.+?)(?=\s+(?:CPF DO FUNCION|PIS DO FUNCION|DATA DE ADMISS|ENT\.|SA[ÍI]\.|HOR[ÁA]RIO DE TRABALHO)|\n|$)/i;

function parseCartaoPonto(pagina: number, linhas: readonly LinhaPonto[]): PaginaPonto | null {
  const texto = textoDaPagina(linhas);
  const nome = RE_NOME_A.exec(texto);
  const cpf = /CPF DO FUNCION[ÁA]RIO:\s*([\d.-]+)/i.exec(texto);

  const dias: DiaPonto[] = [];
  for (const linha of linhas) {
    const primeiro = linha.itens[0];
    if (!primeiro) continue;
    const m = RE_DIA_A.exec(primeiro.texto);
    if (!m) continue;

    const resto = linha.itens.slice(1);
    const textoResto = resto.map((i) => i.texto).join(" ");

    const marcacoes = [...textoResto.matchAll(RE_MARCACAO_A)].map((r) => r[1]);
    const previstos = [...textoResto.matchAll(RE_PREVISTO)];
    const primeiroPrevisto = previstos[0];
    const ultimoPrevisto = previstos[previstos.length - 1];

    dias.push({
      data: `${m[1]}/${m[2]}`,
      marcacoes,
      rotulos: rotulosDe(resto.map((i) => i.texto)),
      previsto:
        primeiroPrevisto && ultimoPrevisto
          ? { entrada: primeiroPrevisto[1], saida: ultimoPrevisto[2] }
          : null,
    });
  }

  if (dias.length === 0) return null;
  return {
    pagina,
    nome: (nome?.[1] ?? "").trim(),
    cpf: somenteDigitos(cpf?.[1] ?? ""),
    dias,
  };
}

// ---------- Layout B: iPonto/Inspell ("Cartão de Ponto Calculado") ----------
//
// A linha do dia começa com "01/07 qua", segue com o código da tabela de
// horário e as batidas e TERMINA com as colunas calculadas (H. Trab., H. Falt.,
// H. Extra), que também são "HH:MM". Só a posição distingue: as colunas
// calculadas ficam à direita do cabeçalho "H. Trab.". Sem esse corte, uma hora
// extra de "01:27" viraria uma saída à 1h27 da manhã.

const RE_DIA_B = /^(\d{2})\/(\d{2})$/;
const DOW_B = new Set(["dom", "seg", "ter", "qua", "qui", "sex", "sáb", "sab"]);
// Fallback do corte quando o cabeçalho não é encontrado: nas duas amostras
// reais as batidas ficam antes de x≈300 e os totais depois de x≈350.
const CORTE_TOTAIS_PADRAO = 340;

function corteDosTotais(linhas: readonly LinhaPonto[]): number {
  for (const linha of linhas) {
    for (const item of linha.itens) {
      if (/^H\.\s*Trab\./i.test(item.texto)) return item.x - 4;
    }
  }
  return CORTE_TOTAIS_PADRAO;
}

// Cabeçalho "Horário de Trabalho": uma linha por dia da semana com as batidas
// previstas. É lido para conferência, não para o cálculo — nas amostras reais
// ele diverge do cadastro em boa parte das páginas.
function previstoDoCabecalho(linhas: readonly LinhaPonto[]): Map<string, HorarioEsperado> {
  const dias: Record<string, string> = {
    Domingo: "dom",
    Segunda: "seg",
    Terça: "ter",
    Quarta: "qua",
    Quinta: "qui",
    Sexta: "sex",
    Sábado: "sáb",
  };
  const mapa = new Map<string, HorarioEsperado>();
  for (const linha of linhas) {
    const indice = linha.itens.findIndex((i) => dias[i.texto] !== undefined);
    if (indice < 0) continue;
    const dow = dias[linha.itens[indice].texto];
    // O nome do dia da semana aparece antes das horas em parte das amostras e
    // depois delas em outras; o lado sem horas é de outro bloco impresso na
    // mesma altura ("Admissão:", "Registro:"…).
    const horasDe = (itens: readonly ItemPonto[]) =>
      itens.flatMap((i) => i.texto.split(/\s+/)).filter((t) => RE_HORA.test(t));
    const depois = horasDe(linha.itens.slice(indice + 1));
    const horas = depois.length >= 2 ? depois : horasDe(linha.itens.slice(0, indice));
    if (horas.length >= 2 && !mapa.has(dow)) {
      mapa.set(dow, { entrada: horas[0], saida: horas[horas.length - 1] });
    }
  }
  return mapa;
}

function parseIponto(pagina: number, linhas: readonly LinhaPonto[]): PaginaPonto | null {
  const texto = textoDaPagina(linhas);
  const nome = /Nome:\s*(.+?)(?:\s{2,}|$)/im.exec(texto);
  const cpf = /CPF:\s*([\d.-]+)/i.exec(texto);
  const corte = corteDosTotais(linhas);
  const previstoSemana = previstoDoCabecalho(linhas);

  const dias: DiaPonto[] = [];
  for (const linha of linhas) {
    const [primeiro, segundo] = linha.itens;
    if (!primeiro) continue;
    // O pdfjs às vezes emite "01/07 qua" num item só e às vezes em dois.
    const partes = primeiro.texto.split(/\s+/);
    const data = RE_DIA_B.exec(partes[0]);
    if (!data) continue;
    const dow = (partes[1] ?? segundo?.texto ?? "").toLowerCase();
    if (!DOW_B.has(dow)) continue;

    const marcacoes: string[] = [];
    const textosRotulo: string[] = [];
    for (const item of linha.itens) {
      if (item.x >= corte) continue;
      if (item === primeiro) continue;
      if (RE_HORA.test(item.texto)) marcacoes.push(item.texto);
      else textosRotulo.push(item.texto);
    }

    dias.push({
      data: `${data[1]}/${data[2]}`,
      marcacoes,
      rotulos: rotulosDe(textosRotulo),
      previsto: previstoSemana.get(dow === "sab" ? "sáb" : dow) ?? null,
    });
  }

  if (dias.length === 0) return null;
  return {
    pagina,
    nome: (nome?.[1] ?? "").trim(),
    cpf: somenteDigitos(cpf?.[1] ?? ""),
    dias,
  };
}

export function parsePaginaPonto(
  pagina: number,
  linhas: readonly LinhaPonto[],
  layout?: LayoutPonto | null,
): PaginaPonto | null {
  const escolhido = layout ?? detectarLayout(linhas);
  if (escolhido === "cartao_ponto") return parseCartaoPonto(pagina, linhas);
  if (escolhido === "iponto") return parseIponto(pagina, linhas);
  return null;
}

// Período impresso no PDF, usado para avisar quando a competência informada não
// corresponde ao arquivo enviado. Devolve "YYYY-MM".
export function competenciaDoPdf(linhas: readonly LinhaPonto[]): string | null {
  const texto = textoDaPagina(linhas);
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s*(?:AT[ÉE]|à|a)\s*\d{2}\/\d{2}\/\d{4}/i.exec(texto);
  if (!m) return null;
  return `${m[3]}-${m[2]}`;
}

// ---------- Casamento com o cadastro ----------
//
// CPF primeiro: nas amostras reais o nome vem truncado ou com erro de grafia
// ("ADRIANA FEREIRA" × "ADRIANA FERREIRA"), enquanto o CPF é estável. O
// casamento por nome (o mesmo dos contracheques) é o fallback.

export type OrigemVinculoPonto = "cpf" | "nome" | "manual";

export function identificarFuncionarioPonto(
  pagina: Pick<PaginaPonto, "nome" | "cpf">,
  funcionarios: readonly FuncionarioPonto[],
): { funcionario: FuncionarioPonto; origem: OrigemVinculoPonto } | null {
  const cpf = somenteDigitos(pagina.cpf ?? "");
  if (cpf.length === 11) {
    const iguais = funcionarios.filter((f) => somenteDigitos(f.cpf ?? "") === cpf);
    if (iguais.length === 1) return { funcionario: iguais[0], origem: "cpf" };
  }

  const nome = (pagina.nome ?? "").trim();
  if (!nome) return null;
  const achado = identificarFuncionarioDaPagina(
    nome,
    funcionarios.map((f) => ({
      id: f.id,
      nomeCompleto: f.nomeCompleto,
      cpf: f.cpf,
      email: "",
      unidade: f.unidade,
      ativo: f.ativo,
    })),
  );
  if (!achado) return null;
  const original = funcionarios.find((f) => f.id === achado.funcionario.id);
  return original ? { funcionario: original, origem: "nome" } : null;
}

// ---------- Cálculo ----------

export type SituacaoDia = "avaliado" | "ignorado" | "inconsistente";

export type ResultadoDia = {
  data: string;
  entrada: string | null;
  saida: string | null;
  atrasoMin: number;
  antecipacaoMin: number;
  situacao: SituacaoDia;
  motivo: string;
};

// Um dia só entra no ranking com jornada fechada: número par de batidas e
// nenhum rótulo misturado. No iPonto é comum sair "07:30 17:36 Falta Falta"
// (bateu de manhã, faltou o turno da tarde) — tratar isso como jornada normal
// produziria um atraso de horas que não existiu.
export function avaliarDia(
  dia: DiaPonto,
  esperado: HorarioEsperado,
  limiarMin: number = LIMIAR_PADRAO_MIN,
): ResultadoDia {
  const base: ResultadoDia = {
    data: dia.data,
    entrada: null,
    saida: null,
    atrasoMin: 0,
    antecipacaoMin: 0,
    situacao: "ignorado",
    motivo: "",
  };

  const marcacoes = dia.marcacoes.filter((m) => minutosDoHorario(m) !== null);

  if (marcacoes.length === 0) {
    return { ...base, motivo: dia.rotulos[0] ?? "sem marcação" };
  }
  if (dia.rotulos.length > 0) {
    return { ...base, situacao: "inconsistente", motivo: `marcação parcial (${dia.rotulos[0]})` };
  }
  if (marcacoes.length % 2 !== 0) {
    return { ...base, situacao: "inconsistente", motivo: "número ímpar de marcações" };
  }

  const entrada = marcacoes[0];
  const saida = marcacoes[marcacoes.length - 1];
  const entradaMin = minutosDoHorario(entrada);
  const saidaMin = minutosDoHorario(saida);
  const esperadoEntrada = minutosDoHorario(esperado.entrada);
  const esperadoSaida = minutosDoHorario(esperado.saida);

  if (entradaMin === null || saidaMin === null) {
    return { ...base, situacao: "inconsistente", motivo: "marcação inválida" };
  }
  if (esperadoEntrada === null || esperadoSaida === null) {
    return { ...base, situacao: "inconsistente", motivo: "horário esperado inválido" };
  }

  const limiar = Math.max(1, Math.round(limiarMin));
  const atraso = entradaMin - esperadoEntrada;
  const antecipacao = esperadoSaida - saidaMin;

  return {
    data: dia.data,
    entrada,
    saida,
    atrasoMin: atraso >= limiar ? atraso : 0,
    antecipacaoMin: antecipacao >= limiar ? antecipacao : 0,
    situacao: "avaliado",
    motivo: "",
  };
}

// ---------- Horário desatualizado ----------
//
// Quando o cadastro está velho (ficha diz 07:00, o funcionário bate 08:00 todo
// dia), contar isso como atraso diário produziria um ranking inteiro de
// ocorrências que não existem. A assinatura desse caso é uma diferença GRANDE e
// CONSISTENTE: aqui, mediana das batidas afastada do cadastro além de
// `DESVIO_MIN_MINUTOS` e repetida na maioria dos dias avaliados. Diferença
// ocasional (chegou tarde em alguns dias) não entra: é atraso de verdade.

export const DESVIO_MIN_MINUTOS = 15;
export const DESVIO_PROPORCAO_MINIMA = 0.8;
// Dispersão aceita em torno da mediana para o dia contar como "mesmo desvio".
export const DESVIO_JANELA_MINUTOS = 10;
// Abaixo disso não há amostra suficiente para afirmar que o cadastro está
// errado — a folha do mês pode ter só dois dias trabalhados.
export const DESVIO_DIAS_MINIMOS = 5;

export type DesvioHorario = {
  entradaSugerida: string;
  saidaSugerida: string;
  // Diferença (em minutos) da mediana real contra o cadastro. Positivo = mais
  // tarde que o cadastrado.
  diferencaEntradaMin: number;
  diferencaSaidaMin: number;
  diasBase: number;
  diasConsistentes: number;
};

function mediana(valores: readonly number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? ordenados[meio]
    : Math.round((ordenados[meio - 1] + ordenados[meio]) / 2);
}

function paraHorario(minutos: number): string {
  const total = ((Math.round(minutos) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Arredonda a sugestão para o múltiplo de 5 minutos mais próximo: horário de
// cadastro é sempre redondo, e a mediana das batidas nunca é.
function arredondar5(minutos: number): number {
  return Math.round(minutos / 5) * 5;
}

export function detectarHorarioDesatualizado(
  dias: readonly DiaPonto[],
  esperado: HorarioEsperado,
): DesvioHorario | null {
  const esperadoEntrada = minutosDoHorario(esperado.entrada);
  const esperadoSaida = minutosDoHorario(esperado.saida);
  if (esperadoEntrada === null || esperadoSaida === null) return null;

  const avaliados = dias
    .map((d) => avaliarDia(d, esperado))
    .filter((d) => d.situacao === "avaliado" && d.entrada && d.saida);
  if (avaliados.length < DESVIO_DIAS_MINIMOS) return null;

  const entradas: number[] = [];
  const saidas: number[] = [];
  for (const d of avaliados) {
    const e = minutosDoHorario(d.entrada ?? "");
    const s = minutosDoHorario(d.saida ?? "");
    if (e === null || s === null) continue;
    entradas.push(e);
    saidas.push(s);
  }
  if (entradas.length < DESVIO_DIAS_MINIMOS) return null;

  const medianaEntrada = mediana(entradas);
  const medianaSaida = mediana(saidas);
  const difEntrada = medianaEntrada - esperadoEntrada;
  const difSaida = medianaSaida - esperadoSaida;

  const entradaDesviada = Math.abs(difEntrada) >= DESVIO_MIN_MINUTOS;
  const saidaDesviada = Math.abs(difSaida) >= DESVIO_MIN_MINUTOS;
  if (!entradaDesviada && !saidaDesviada) return null;

  // Consistência: só conta o dia que repete o desvio nos campos desviados.
  let consistentes = 0;
  for (let i = 0; i < entradas.length; i++) {
    const okEntrada =
      !entradaDesviada || Math.abs(entradas[i] - medianaEntrada) <= DESVIO_JANELA_MINUTOS;
    const okSaida = !saidaDesviada || Math.abs(saidas[i] - medianaSaida) <= DESVIO_JANELA_MINUTOS;
    if (okEntrada && okSaida) consistentes += 1;
  }
  if (consistentes / entradas.length < DESVIO_PROPORCAO_MINIMA) return null;

  return {
    entradaSugerida: paraHorario(arredondar5(medianaEntrada)),
    saidaSugerida: paraHorario(arredondar5(medianaSaida)),
    diferencaEntradaMin: difEntrada,
    diferencaSaidaMin: difSaida,
    diasBase: entradas.length,
    diasConsistentes: consistentes,
  };
}

export type ResumoFuncionario = {
  funcionarioId: string | null;
  nome: string;
  pagina: number;
  diasAtraso: number;
  minutosAtraso: number;
  diasAntecipacao: number;
  minutosAntecipacao: number;
  diasAvaliados: number;
  diasInconsistentes: number;
  dias: ResultadoDia[];
};

export function agregarDias(
  dias: readonly DiaPonto[],
  esperado: HorarioEsperado,
  toleranciaMin: number = LIMIAR_PADRAO_MIN,
): Omit<ResumoFuncionario, "funcionarioId" | "nome" | "pagina"> {
  const avaliados = dias.map((d) => avaliarDia(d, esperado, toleranciaMin));
  return {
    diasAtraso: avaliados.filter((d) => d.atrasoMin > 0).length,
    minutosAtraso: avaliados.reduce((soma, d) => soma + d.atrasoMin, 0),
    diasAntecipacao: avaliados.filter((d) => d.antecipacaoMin > 0).length,
    minutosAntecipacao: avaliados.reduce((soma, d) => soma + d.antecipacaoMin, 0),
    diasAvaliados: avaliados.filter((d) => d.situacao === "avaliado").length,
    diasInconsistentes: avaliados.filter((d) => d.situacao === "inconsistente").length,
    dias: avaliados,
  };
}

export type LinhaRanking = {
  funcionarioId: string | null;
  nome: string;
  dias: number;
  minutos: number;
};

// Mais minutos primeiro; empate desempata por dias e depois por nome, para a
// ordem não variar entre processamentos.
function ordenar(linhas: LinhaRanking[]): LinhaRanking[] {
  return linhas.sort((a, b) => {
    if (b.minutos !== a.minutos) return b.minutos - a.minutos;
    if (b.dias !== a.dias) return b.dias - a.dias;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

export function rankingAtrasos(resumos: readonly ResumoFuncionario[]): LinhaRanking[] {
  return ordenar(
    resumos
      .filter((r) => r.diasAtraso > 0)
      .map((r) => ({
        funcionarioId: r.funcionarioId,
        nome: r.nome,
        dias: r.diasAtraso,
        minutos: r.minutosAtraso,
      })),
  );
}

export function rankingSaidasAntecipadas(resumos: readonly ResumoFuncionario[]): LinhaRanking[] {
  return ordenar(
    resumos
      .filter((r) => r.diasAntecipacao > 0)
      .map((r) => ({
        funcionarioId: r.funcionarioId,
        nome: r.nome,
        dias: r.diasAntecipacao,
        minutos: r.minutosAntecipacao,
      })),
  );
}

// ---------- Conferência da folha ----------

export type StatusPaginaPonto =
  | "processada"
  | "sem_correspondencia"
  | "sem_horario"
  | "sem_dias"
  | "horario_desatualizado";

export type PaginaConferida = {
  pagina: number;
  nomeNoPdf: string;
  cpfNoPdf: string;
  funcionarioId: string | null;
  funcionarioNome: string;
  origem: OrigemVinculoPonto | null;
  status: StatusPaginaPonto;
  esperado: HorarioEsperado | null;
  // Horário impresso no PDF, quando diverge do cadastro: o cálculo usa o
  // cadastro, mas a divergência precisa ficar visível na conferência.
  previstoNoPdf: HorarioEsperado | null;
  // Desvio consistente entre as batidas e o cadastro. Quando presente, a página
  // sai dos rankings e entra na lista de horários a atualizar.
  desvio: DesvioHorario | null;
  resumo: ResumoFuncionario;
};

export const LABEL_STATUS_PONTO: Record<StatusPaginaPonto, string> = {
  processada: "Processada",
  sem_correspondencia: "Funcionário não localizado no RH",
  sem_horario: "Funcionário sem horário cadastrado",
  sem_dias: "Nenhum dia interpretável na página",
  horario_desatualizado: "Horário do cadastro desatualizado",
};

function previstoPredominante(dias: readonly DiaPonto[]): HorarioEsperado | null {
  const contagem = new Map<string, { horario: HorarioEsperado; n: number }>();
  for (const d of dias) {
    if (!d.previsto) continue;
    const chave = `${d.previsto.entrada}-${d.previsto.saida}`;
    const atual = contagem.get(chave);
    if (atual) atual.n += 1;
    else contagem.set(chave, { horario: d.previsto, n: 1 });
  }
  let melhor: { horario: HorarioEsperado; n: number } | null = null;
  for (const v of contagem.values()) if (!melhor || v.n > melhor.n) melhor = v;
  return melhor?.horario ?? null;
}

// Monta a conferência de uma página com o vínculo já decidido (automático ou
// manual). O vínculo manual não passa pelo casamento de novo: o usuário mandou.
export function conferirComFuncionario(
  pagina: PaginaPonto,
  funcionario: FuncionarioPonto | null,
  origem: OrigemVinculoPonto | null,
  toleranciaMin: number = LIMIAR_PADRAO_MIN,
): PaginaConferida {
  const previstoNoPdf = previstoPredominante(pagina.dias);

  const esperado: HorarioEsperado | null = funcionario
    ? { entrada: funcionario.horarioInicio ?? "", saida: funcionario.horarioFim ?? "" }
    : null;
  const esperadoValido =
    esperado &&
    minutosDoHorario(esperado.entrada) !== null &&
    minutosDoHorario(esperado.saida) !== null
      ? esperado
      : null;

  const vazio: ResumoFuncionario = {
    funcionarioId: funcionario?.id ?? null,
    nome: funcionario?.nomeCompleto || pagina.nome,
    pagina: pagina.pagina,
    diasAtraso: 0,
    minutosAtraso: 0,
    diasAntecipacao: 0,
    minutosAntecipacao: 0,
    diasAvaliados: 0,
    diasInconsistentes: 0,
    dias: [],
  };

  const desvio =
    funcionario && esperadoValido
      ? detectarHorarioDesatualizado(pagina.dias, esperadoValido)
      : null;

  let status: StatusPaginaPonto = "processada";
  if (!funcionario) status = "sem_correspondencia";
  else if (!esperadoValido) status = "sem_horario";
  else if (pagina.dias.length === 0) status = "sem_dias";
  else if (desvio) status = "horario_desatualizado";

  // Os dias continuam calculados (a tela mostra as batidas e o histórico grava
  // dia a dia), mas a contagem de atraso e de saída antecipada zera enquanto o
  // cadastro estiver desatualizado: comparar contra o horário errado só geraria
  // ocorrência falsa.
  const calculado =
    funcionario && esperadoValido ? agregarDias(pagina.dias, esperadoValido, toleranciaMin) : null;

  const resumo = calculado
    ? {
        ...vazio,
        ...calculado,
        ...(desvio
          ? {
              diasAtraso: 0,
              minutosAtraso: 0,
              diasAntecipacao: 0,
              minutosAntecipacao: 0,
            }
          : {}),
      }
    : vazio;

  return {
    pagina: pagina.pagina,
    nomeNoPdf: pagina.nome,
    cpfNoPdf: pagina.cpf,
    funcionarioId: funcionario?.id ?? null,
    funcionarioNome: funcionario?.nomeCompleto ?? "",
    origem: funcionario ? origem : null,
    status,
    esperado: esperadoValido,
    previstoNoPdf,
    desvio,
    resumo,
  };
}

export function conferirPagina(
  pagina: PaginaPonto,
  funcionarios: readonly FuncionarioPonto[],
  toleranciaMin: number = LIMIAR_PADRAO_MIN,
): PaginaConferida {
  const achado = identificarFuncionarioPonto(pagina, funcionarios);
  return conferirComFuncionario(
    pagina,
    achado?.funcionario ?? null,
    achado?.origem ?? null,
    toleranciaMin,
  );
}

export function conferirFolha(
  paginas: readonly PaginaPonto[],
  funcionarios: readonly FuncionarioPonto[],
  toleranciaMin: number = LIMIAR_PADRAO_MIN,
): PaginaConferida[] {
  return paginas.map((p) => conferirPagina(p, funcionarios, toleranciaMin));
}

export function revincularPagina(
  conferidas: readonly PaginaConferida[],
  paginas: readonly PaginaPonto[],
  pagina: number,
  funcionario: FuncionarioPonto | null,
  toleranciaMin: number = LIMIAR_PADRAO_MIN,
): PaginaConferida[] {
  return conferidas.map((c) => {
    if (c.pagina !== pagina) return c;
    const original = paginas.find((p) => p.pagina === pagina);
    if (!original) return c;
    return conferirComFuncionario(original, funcionario, "manual", toleranciaMin);
  });
}

export function resumosProcessados(conferidas: readonly PaginaConferida[]): ResumoFuncionario[] {
  return conferidas.filter((c) => c.status === "processada").map((c) => c.resumo);
}

export type HorarioParaAtualizar = {
  funcionarioId: string;
  nome: string;
  pagina: number;
  cadastrado: HorarioEsperado;
  sugerido: HorarioEsperado;
  desvio: DesvioHorario;
};

// Lista da tela "Horários desatualizados": um item por funcionário cujo cadastro
// não corresponde às batidas do mês, com o horário sugerido para o um-clique.
export function horariosParaAtualizar(
  conferidas: readonly PaginaConferida[],
): HorarioParaAtualizar[] {
  const itens: HorarioParaAtualizar[] = [];
  for (const c of conferidas) {
    if (!c.desvio || !c.esperado || !c.funcionarioId) continue;
    itens.push({
      funcionarioId: c.funcionarioId,
      nome: c.funcionarioNome || c.nomeNoPdf,
      pagina: c.pagina,
      cadastrado: c.esperado,
      sugerido: { entrada: c.desvio.entradaSugerida, saida: c.desvio.saidaSugerida },
      desvio: c.desvio,
    });
  }
  return itens.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export type ResumoFolha = {
  paginas: number;
  processadas: number;
  semCorrespondencia: number;
  semHorario: number;
  semDias: number;
  horariosDesatualizados: number;
  diasInconsistentes: number;
  horarioDivergente: number;
};

export function resumirFolha(conferidas: readonly PaginaConferida[]): ResumoFolha {
  return {
    paginas: conferidas.length,
    processadas: conferidas.filter((c) => c.status === "processada").length,
    semCorrespondencia: conferidas.filter((c) => c.status === "sem_correspondencia").length,
    semHorario: conferidas.filter((c) => c.status === "sem_horario").length,
    semDias: conferidas.filter((c) => c.status === "sem_dias").length,
    horariosDesatualizados: conferidas.filter((c) => c.status === "horario_desatualizado").length,
    diasInconsistentes: conferidas.reduce((s, c) => s + c.resumo.diasInconsistentes, 0),
    horarioDivergente: conferidas.filter(
      (c) =>
        c.esperado &&
        c.previstoNoPdf &&
        (c.esperado.entrada !== c.previstoNoPdf.entrada ||
          c.esperado.saida !== c.previstoNoPdf.saida),
    ).length,
  };
}

// ---------- Persistência dia a dia ----------

export type DiaParaGravar = {
  funcionarioId: string;
  data: string; // ISO (YYYY-MM-DD)
  entrada: string | null;
  saida: string | null;
  atrasoMin: number;
  antecipacaoMin: number;
  situacao: SituacaoDia;
};

// O PDF traz o dia como "DD/MM" e o ano vem da competência. Uma folha de janeiro
// pode conter dias de dezembro (fechamento a cavalo do mês), então o ano recua
// quando o mês do dia é maior que o da competência.
export function dataIsoDoDia(competencia: string, diaMes: string): string | null {
  const comp = /^(\d{4})-(\d{2})$/.exec(competencia);
  const dia = /^(\d{2})\/(\d{2})$/.exec(diaMes);
  if (!comp || !dia) return null;
  const mes = Number(dia[2]);
  const d = Number(dia[1]);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  const ano = mes > Number(comp[2]) ? Number(comp[1]) - 1 : Number(comp[1]);
  return `${ano}-${dia[2]}-${dia[1]}`;
}

// Dias de todas as páginas com funcionário identificado — inclusive as de
// horário desatualizado, que ficam fora do ranking mas cujas batidas são o
// insumo para reconferir o período depois sem reimportar o PDF.
export function diasParaGravar(
  conferidas: readonly PaginaConferida[],
  competencia: string,
): DiaParaGravar[] {
  const linhas: DiaParaGravar[] = [];
  for (const c of conferidas) {
    if (!c.funcionarioId) continue;
    for (const d of c.resumo.dias) {
      const data = dataIsoDoDia(competencia, d.data);
      if (!data) continue;
      linhas.push({
        funcionarioId: c.funcionarioId,
        data,
        entrada: d.entrada,
        saida: d.saida,
        atrasoMin: c.desvio ? 0 : d.atrasoMin,
        antecipacaoMin: c.desvio ? 0 : d.antecipacaoMin,
        situacao: d.situacao,
      });
    }
  }
  return linhas;
}

// ---------- Competência ----------

export function competenciaAnterior(hoje: Date = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function competenciaFutura(competencia: string, hoje: Date = new Date()): boolean {
  const atual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  return competencia > atual;
}

// ---------- Ranking a partir das batidas já gravadas ----------

// Linha lida de `hr_timesheet_days`: um dia de um funcionário. Dias de quem
// estava com horário desatualizado chegam aqui já zerados na gravação, então
// não geram ocorrência.
export type DiaPontoGravado = {
  funcionarioId: string;
  nome: string;
  atrasoMin: number;
  antecipacaoMin: number;
};

export type LinhaRankingPonto = {
  funcionarioId: string;
  nome: string;
  // Dias com pelo menos uma ocorrência (atraso e saída antecipada no mesmo dia
  // contam como um dia só).
  dias: number;
  diasAtraso: number;
  diasAntecipacao: number;
  totalMinutos: number;
};

// Soma as ocorrências do período por funcionário. Ordena pelo total de minutos
// e, no empate, por dias com ocorrência.
export function agregarPontoPorFuncionario(dias: readonly DiaPontoGravado[]): LinhaRankingPonto[] {
  const porFuncionario = new Map<string, LinhaRankingPonto>();
  for (const d of dias) {
    const atraso = Math.max(0, d.atrasoMin);
    const antecipacao = Math.max(0, d.antecipacaoMin);
    if (atraso === 0 && antecipacao === 0) continue;
    const atual = porFuncionario.get(d.funcionarioId) ?? {
      funcionarioId: d.funcionarioId,
      nome: d.nome,
      dias: 0,
      diasAtraso: 0,
      diasAntecipacao: 0,
      totalMinutos: 0,
    };
    atual.dias += 1;
    if (atraso > 0) atual.diasAtraso += 1;
    if (antecipacao > 0) atual.diasAntecipacao += 1;
    atual.totalMinutos += atraso + antecipacao;
    porFuncionario.set(d.funcionarioId, atual);
  }
  return [...porFuncionario.values()].sort(
    (a, b) => b.totalMinutos - a.totalMinutos || b.dias - a.dias,
  );
}
