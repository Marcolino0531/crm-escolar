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

function parseCartaoPonto(pagina: number, linhas: readonly LinhaPonto[]): PaginaPonto | null {
  const texto = textoDaPagina(linhas);
  const nome = /NOME DO FUNCION[ÁA]RIO:\s*(.+?)\s+CPF DO FUNCION/i.exec(texto);
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
    const ultimo = linha.itens[linha.itens.length - 1];
    if (!ultimo) continue;
    const dow = dias[ultimo.texto];
    if (!dow) continue;
    const horas = linha.itens
      .slice(0, -1)
      .map((i) => i.texto)
      .filter((t) => RE_HORA.test(t));
    if (horas.length >= 2) {
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
  toleranciaMin: number = 0,
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

  const tolerancia = Math.max(0, Math.round(toleranciaMin));
  const atraso = entradaMin - esperadoEntrada;
  const antecipacao = esperadoSaida - saidaMin;

  return {
    data: dia.data,
    entrada,
    saida,
    atrasoMin: atraso > tolerancia ? atraso : 0,
    antecipacaoMin: antecipacao > tolerancia ? antecipacao : 0,
    situacao: "avaliado",
    motivo: "",
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
  toleranciaMin: number = 0,
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

export type StatusPaginaPonto = "processada" | "sem_correspondencia" | "sem_horario" | "sem_dias";

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
  resumo: ResumoFuncionario;
};

export const LABEL_STATUS_PONTO: Record<StatusPaginaPonto, string> = {
  processada: "Processada",
  sem_correspondencia: "Funcionário não localizado no RH",
  sem_horario: "Funcionário sem horário cadastrado",
  sem_dias: "Nenhum dia interpretável na página",
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
  toleranciaMin: number = 0,
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

  let status: StatusPaginaPonto = "processada";
  if (!funcionario) status = "sem_correspondencia";
  else if (!esperadoValido) status = "sem_horario";
  else if (pagina.dias.length === 0) status = "sem_dias";

  const resumo =
    funcionario && esperadoValido
      ? {
          ...vazio,
          ...agregarDias(pagina.dias, esperadoValido, toleranciaMin),
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
    resumo,
  };
}

export function conferirPagina(
  pagina: PaginaPonto,
  funcionarios: readonly FuncionarioPonto[],
  toleranciaMin: number = 0,
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
  toleranciaMin: number = 0,
): PaginaConferida[] {
  return paginas.map((p) => conferirPagina(p, funcionarios, toleranciaMin));
}

export function revincularPagina(
  conferidas: readonly PaginaConferida[],
  paginas: readonly PaginaPonto[],
  pagina: number,
  funcionario: FuncionarioPonto | null,
  toleranciaMin: number = 0,
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

export type ResumoFolha = {
  paginas: number;
  processadas: number;
  semCorrespondencia: number;
  semHorario: number;
  semDias: number;
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

// ---------- Competência ----------

export function competenciaAnterior(hoje: Date = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function competenciaFutura(competencia: string, hoje: Date = new Date()): boolean {
  const atual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  return competencia > atual;
}
