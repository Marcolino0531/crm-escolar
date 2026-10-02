// Leitura do "Extrato Mensal" (sistema Domínio) a partir dos itens de texto do
// pdfjs — lógica pura, sem pdfjs nem rede. O PDF é lido só no navegador
// (extrato-mensal.pdf.ts); o servidor recebe apenas a FolhaExtrato estruturada
// e revalida a integridade com conferirIntegridade().
//
// Layout (por rótulos; a única posição fixa é a divisão das rubricas):
//   cabeçalho  Empresa: / CNPJ: / Cálculo: / Competência: / Página: / Emissão:
//   bloco      Empr.: (empregado) ou Contr: (contribuinte) → Vínculo: → Cargo:
//              → rubricas (x < 290 provento "… valor P"; x >= 290 desconto "… valor D")
//              → ND: (totais) → NF: (bases) → observações livres
//   final      Total Geral Proventos: / Total Geral Descontos: / Líquido Geral:
//              seguidos de "Resumo por Rubrica" e "Situações / Bases" (ignorados).

export type ItemTexto = {
  str: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  eol?: boolean;
};
export type PaginaItens = { pagina: number; itens: readonly ItemTexto[] };

export type TipoRubrica = "P" | "D";
export type TipoColaborador = "empregado" | "contribuinte";

export type RubricaExtrato = {
  tipo: TipoRubrica;
  codigo: string;
  descricao: string;
  /** Referência como aparece no PDF ("30,00", "18:00", "RESCISAO"…); "" se ausente. */
  referencia: string;
  /** Valor-hora impresso antes da referência (ex.: "27,64ha"); "" se ausente. */
  valorHora: string;
  valor: number;
};

export type ColaboradorExtrato = {
  tipo: TipoColaborador;
  codigo: string;
  nome: string;
  cpf: string;
  situacao: string;
  vinculo: string;
  /** dd/mm/aaaa, como no PDF. */
  admissao: string;
  cargoCodigo: string;
  cargo: string;
  cbo: string;
  /** "137,50" ou "" quando o PDF deixa vazio. */
  horasMes: string;
  salarioBase: number;
  rubricas: RubricaExtrato[];
  proventos: number;
  descontos: number;
  informativa: number;
  informativaDedutora: number;
  liquido: number;
  baseInss: number;
  excedenteInss: number;
  baseFgts: number;
  valorFgts: number;
  baseIrrf: number;
  /** Linhas livres do bloco (ex.: "DEMITIDO EM 24/09/2026 - MOTIVO …"). */
  observacoes: string[];
  pagina: number;
};

export type FolhaExtrato = {
  empresa: string;
  cnpj: string;
  calculo: string;
  /** AAAA-MM. */
  competencia: string;
  totalProventos: number;
  totalDescontos: number;
  liquidoGeral: number;
  colaboradores: ColaboradorExtrato[];
};

export class ErroExtratoMensal extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroExtratoMensal";
  }
}

export const CALCULO_ACEITO = "Folha Mensal";
export const CODIGO_INSS = "998";
export const DIVISAO_RUBRICAS_X = 290;
const TOLERANCIA_Y = 2;

// ---------- Dinheiro em centavos ----------

const RE_NUMERO = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/** "1.081,13" | "1081,13" | "-12,5" | "0" → centavos (inteiro); null se não for número. */
export function centavosBR(texto: string): number | null {
  const m = RE_NUMERO.exec(texto.trim());
  if (!m) return null;
  const inteiro = Number(m[2].replace(/\./g, ""));
  const frac = m[3] ? Number(m[3].padEnd(2, "0")) : 0;
  const c = inteiro * 100 + frac;
  return m[1] ? -c : c;
}

export const paraCentavos = (v: number): number => Math.round(v * 100);
export const deCentavos = (c: number): number => c / 100;
export const somaCentavos = (valores: readonly number[]): number =>
  valores.reduce((s, v) => s + paraCentavos(v), 0);
export const somaReais = (valores: readonly number[]): number => deCentavos(somaCentavos(valores));
export const subtraiReais = (a: number, b: number): number =>
  deCentavos(paraCentavos(a) - paraCentavos(b));

export function formatarReais(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export const somenteDigitos = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");

// ---------- Linhas ----------

export type Linha = { pagina: number; y: number; itens: ItemTexto[] };

/** Agrupa os itens da página em linhas (|Δy| ≤ 2 pt), de cima para baixo, itens por x. */
export function agruparLinhas(pagina: PaginaItens): Linha[] {
  const itens = pagina.itens
    .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
    .slice()
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: Linha[] = [];
  for (const item of itens) {
    const atual = linhas[linhas.length - 1];
    if (atual && Math.abs(atual.y - item.y) <= TOLERANCIA_Y) atual.itens.push(item);
    else linhas.push({ pagina: pagina.pagina, y: item.y, itens: [item] });
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  return linhas;
}

const textoLinha = (l: Linha) =>
  l.itens
    .map((i) => i.str.trim())
    .join(" ")
    .replace(/\s+/g, " ");

/**
 * Lê "Rótulo: valor" de uma linha. O valor é o texto entre o rótulo e o
 * próximo rótulo conhecido (o rótulo pode vir no mesmo item do valor, ex.: "Filial: 1").
 */
function campos(l: Linha, rotulos: readonly string[]): Map<string, string[]> {
  const ordenados = [...rotulos].sort((a, b) => b.length - a.length);
  const mapa = new Map<string, string[]>();
  let atual: string | null = null;
  for (const item of l.itens) {
    const s = item.str.trim();
    const rot = ordenados.find((r) => s === r || s.startsWith(`${r} `));
    if (rot) {
      atual = rot;
      mapa.set(rot, []);
      const resto = s.slice(rot.length).trim();
      if (resto) mapa.get(rot)!.push(resto);
    } else if (atual) {
      mapa.get(atual)!.push(s);
    }
  }
  return mapa;
}

const juntar = (v: string[] | undefined) => (v ?? []).join(" ").trim();

function valorCampo(m: Map<string, string[]>, rotulo: string, onde: string): number {
  const bruto = juntar(m.get(rotulo)?.slice(0, 1));
  const c = centavosBR(bruto);
  if (c == null) throw new ErroExtratoMensal(`${onde}: valor de "${rotulo}" ilegível ("${bruto}").`);
  return deCentavos(c);
}

const comeca = (l: Linha, prefixo: string) => l.itens[0]?.str.trim().startsWith(prefixo) ?? false;

// ---------- Rubricas ----------

const RE_REFERENCIA = /^-?[\d.]+(?:,\d+)?$|^\d{1,3}:\d{2}$/;

function rubricaDe(
  tokens: string[],
  tipo: TipoRubrica,
  onde: string,
): RubricaExtrato {
  const t = tokens.slice();
  // valor + letra: "417,16 D" (um item) ou "566,03" + "P" (dois itens)
  const ultimo = t.pop() ?? "";
  let valorTxt: string;
  if (ultimo === tipo) valorTxt = t.pop() ?? "";
  else if (ultimo.endsWith(` ${tipo}`) || ultimo.endsWith(tipo)) valorTxt = ultimo.slice(0, -1).trim();
  else throw new ErroExtratoMensal(`${onde}: rubrica sem a letra ${tipo} ("${tokens.join(" ")}").`);
  const c = centavosBR(valorTxt);
  if (c == null) {
    throw new ErroExtratoMensal(`${onde}: valor da rubrica ilegível ("${tokens.join(" ")}").`);
  }
  // referência (número ou horas) e, antes dela, um valor-hora opcional "20,08ha"
  let referencia = "";
  let valorHora = "";
  const id = (s: string) => /^\d+(\s|$)/.test(s);
  if (t.length > 1 && RE_REFERENCIA.test(t[t.length - 1])) referencia = t.pop()!;
  if (t.length > 1 && /ha$/i.test(t[t.length - 1])) valorHora = t.pop()!;
  const cabeca = t.join(" ").replace(/\s+/g, " ").trim();
  const m = /^(\d+)\s*(.*)$/.exec(cabeca);
  if (!m || !id(cabeca)) {
    throw new ErroExtratoMensal(`${onde}: rubrica sem código ("${tokens.join(" ")}").`);
  }
  let descricao = m[2].trim();
  // Referência textual (ex.: "13 SALARIO | RESCISAO | 3,00"): fica na descrição só
  // o primeiro item; o segundo item textual é a referência quando já há número.
  if (!referencia && t.length >= 2) {
    const ult = t[t.length - 1];
    if (!/^\d+\s/.test(ult) && t.length > 2) {
      referencia = ult;
      descricao = t
        .slice(0, -1)
        .join(" ")
        .replace(/^\d+\s*/, "")
        .trim();
    }
  }
  return { tipo, codigo: m[1], descricao, referencia, valorHora, valor: deCentavos(c) };
}

function rubricasDaLinha(l: Linha, onde: string): RubricaExtrato[] {
  const esq = l.itens.filter((i) => i.x < DIVISAO_RUBRICAS_X).map((i) => i.str.trim());
  const dir = l.itens.filter((i) => i.x >= DIVISAO_RUBRICAS_X).map((i) => i.str.trim());
  const out: RubricaExtrato[] = [];
  if (esq.length) out.push(rubricaDe(esq, "P", onde));
  if (dir.length) out.push(rubricaDe(dir, "D", onde));
  return out;
}

// ---------- Leitura ----------

const ROT_IDENT = ["Empr.:", "Contr:", "Situação:", "CPF:", "Adm:"];
const ROT_VINCULO = ["Vínculo:", "CC:", "Depto:", "Horas Mês:"];
const ROT_CARGO = ["Cargo:", "C.B.O:", "Filial:", "Salário:"];
const ROT_ND = [
  "ND:",
  "Proventos:",
  "Descontos:",
  "Informativa:",
  "Informativa Dedutora:",
  "Líquido:",
];
const ROT_NF = ["NF:", "Base INSS:", "Excedente INSS:", "Base FGTS:", "Valor FGTS:", "Base IRRF:"];
const ROT_CABECALHO = ["Empresa:", "CNPJ:", "Cálculo:", "Competência:", "Página:", "Emissão:", "Horas:"];

function ehCabecalho(l: Linha): boolean {
  const t = textoLinha(l);
  return (
    ROT_CABECALHO.some((r) => comeca(l, r)) ||
    t === "EXTRATO MENSAL" ||
    /^Sistema licenciado/i.test(t)
  );
}

const soRotulos = (l: Linha) => l.itens.every((i) => /:$/.test(i.str.trim()));

type Parcial = Omit<ColaboradorExtrato, "proventos" | "descontos" | "liquido"> & {
  proventos: number | null;
  descontos: number | null;
  liquido: number | null;
  nfLido: boolean;
};

function nomeColaborador(c: { codigo: string; nome: string }) {
  return `${c.codigo} ${c.nome}`;
}

/**
 * Lê o Extrato Mensal a partir dos itens de texto por página (formato do pdfjs:
 * x = transform[4], y = transform[5]). Lança ErroExtratoMensal com a página e
 * o colaborador quando o layout não é reconhecido. Não confere a integridade
 * (ver conferirIntegridade).
 */
export function lerExtratoMensal(paginas: readonly PaginaItens[]): FolhaExtrato {
  const cab = { empresa: "", cnpj: "", calculo: "", competencia: "" };
  const totais = { proventos: null as number | null, descontos: null as number | null, liquido: null as number | null };
  const colaboradores: ColaboradorExtrato[] = [];
  let atual: Parcial | null = null;
  let fimDaFolha = false;

  const fechar = () => {
    if (!atual) return;
    const onde = `Colaborador ${nomeColaborador(atual)} (página ${atual.pagina})`;
    if (atual.proventos == null || atual.descontos == null || atual.liquido == null) {
      throw new ErroExtratoMensal(`${onde}: linha "ND:" com Proventos/Descontos/Líquido não encontrada.`);
    }
    if (!atual.nfLido) throw new ErroExtratoMensal(`${onde}: linha "NF:" com as bases não encontrada.`);
    const { nfLido: _nf, ...resto } = atual;
    void _nf;
    colaboradores.push({
      ...resto,
      proventos: atual.proventos,
      descontos: atual.descontos,
      liquido: atual.liquido,
    });
    atual = null;
  };

  const ordenadas = [...paginas].sort((a, b) => a.pagina - b.pagina);
  for (const pagina of ordenadas) {
    for (const l of agruparLinhas(pagina)) {
      const onde = `Página ${l.pagina}`;
      if (ehCabecalho(l)) {
        const m = campos(l, ROT_CABECALHO);
        if (m.has("Empresa:") && !cab.empresa) cab.empresa = juntar(m.get("Empresa:"));
        if (m.has("CNPJ:") && !cab.cnpj) cab.cnpj = juntar(m.get("CNPJ:"));
        if (m.has("Cálculo:")) {
          const calc = juntar(m.get("Cálculo:"));
          if (cab.calculo && calc !== cab.calculo) {
            throw new ErroExtratoMensal(`${onde}: cálculo "${calc}" diferente de "${cab.calculo}".`);
          }
          cab.calculo = calc;
        }
        if (m.has("Competência:")) {
          const comp = juntar(m.get("Competência:"));
          const mm = /^(\d{2})\/(\d{4})$/.exec(comp);
          if (!mm) throw new ErroExtratoMensal(`${onde}: competência ilegível ("${comp}").`);
          const iso = `${mm[2]}-${mm[1]}`;
          if (cab.competencia && iso !== cab.competencia) {
            throw new ErroExtratoMensal(`${onde}: competência ${comp} diferente das páginas anteriores.`);
          }
          cab.competencia = iso;
        }
        continue;
      }
      if (fimDaFolha) continue;

      if (comeca(l, "Total Geral Proventos:") || comeca(l, "Total Geral Descontos:") || comeca(l, "Líquido Geral:")) {
        fechar();
        const m = campos(l, ["Total Geral Proventos:", "Total Geral Descontos:", "Líquido Geral:"]);
        if (m.has("Total Geral Proventos:")) totais.proventos = valorCampo(m, "Total Geral Proventos:", onde);
        if (m.has("Total Geral Descontos:")) totais.descontos = valorCampo(m, "Total Geral Descontos:", onde);
        if (m.has("Líquido Geral:")) totais.liquido = valorCampo(m, "Líquido Geral:", onde);
        if (totais.proventos != null && totais.descontos != null && totais.liquido != null) {
          fimDaFolha = true; // o que vem depois (Resumo por Rubrica, Situações / Bases) não é colaborador
        }
        continue;
      }

      if (comeca(l, "Empr.:") || comeca(l, "Contr:")) {
        fechar();
        const tipo: TipoColaborador = comeca(l, "Empr.:") ? "empregado" : "contribuinte";
        const m = campos(l, ROT_IDENT);
        const ident = juntar(m.get(tipo === "empregado" ? "Empr.:" : "Contr:"));
        const mm = /^(\d+)\s+(.+)$/.exec(ident);
        if (!mm) throw new ErroExtratoMensal(`${onde}: código/nome do colaborador ilegível ("${ident}").`);
        atual = {
          tipo,
          codigo: mm[1],
          nome: mm[2].trim(),
          cpf: juntar(m.get("CPF:")),
          situacao: juntar(m.get("Situação:")),
          admissao: juntar(m.get("Adm:")),
          vinculo: "",
          cargoCodigo: "",
          cargo: "",
          cbo: "",
          horasMes: "",
          salarioBase: 0,
          rubricas: [],
          proventos: null,
          descontos: null,
          liquido: null,
          informativa: 0,
          informativaDedutora: 0,
          baseInss: 0,
          excedenteInss: 0,
          baseFgts: 0,
          valorFgts: 0,
          baseIrrf: 0,
          observacoes: [],
          pagina: l.pagina,
          nfLido: false,
        };
        continue;
      }

      if (!atual) {
        throw new ErroExtratoMensal(`${onde}: linha fora de um colaborador ("${textoLinha(l)}").`);
      }
      const c: Parcial = atual;
      const ondeC = `Colaborador ${nomeColaborador(c)} (página ${l.pagina})`;

      if (comeca(l, "Vínculo:")) {
        const m = campos(l, ROT_VINCULO);
        c.vinculo = juntar(m.get("Vínculo:"));
        c.horasMes = juntar(m.get("Horas Mês:"));
      } else if (comeca(l, "Cargo:")) {
        const m = campos(l, ROT_CARGO);
        const cargo = juntar(m.get("Cargo:"));
        const mm = /^(\d+)\s+(.+)$/.exec(cargo);
        c.cargoCodigo = mm ? mm[1] : "";
        c.cargo = mm ? mm[2].trim() : cargo;
        c.cbo = juntar(m.get("C.B.O:"));
        c.salarioBase = m.has("Salário:") && juntar(m.get("Salário:")) ? valorCampo(m, "Salário:", ondeC) : 0;
      } else if (comeca(l, "ND:")) {
        const m = campos(l, ROT_ND);
        c.proventos = valorCampo(m, "Proventos:", ondeC);
        // Descontos/Informativa/Informativa Dedutora podem vir sem os rótulos intermediários
        const aposDescontos = m.get("Descontos:") ?? [];
        const desc = centavosBR(aposDescontos[0] ?? "");
        if (desc == null) throw new ErroExtratoMensal(`${ondeC}: valor de "Descontos:" ilegível.`);
        c.descontos = deCentavos(desc);
        const info = m.has("Informativa:") ? m.get("Informativa:")![0] : aposDescontos[1];
        const ded = m.has("Informativa Dedutora:")
          ? m.get("Informativa Dedutora:")![0]
          : m.has("Informativa:")
            ? m.get("Informativa:")![1]
            : aposDescontos[2];
        c.informativa = deCentavos(centavosBR(info ?? "0") ?? 0);
        c.informativaDedutora = deCentavos(centavosBR(ded ?? "0") ?? 0);
        c.liquido = valorCampo(m, "Líquido:", ondeC);
      } else if (comeca(l, "NF:")) {
        const m = campos(l, ROT_NF);
        c.baseInss = valorCampo(m, "Base INSS:", ondeC);
        c.excedenteInss = valorCampo(m, "Excedente INSS:", ondeC);
        c.baseFgts = valorCampo(m, "Base FGTS:", ondeC);
        c.valorFgts = valorCampo(m, "Valor FGTS:", ondeC);
        c.baseIrrf = valorCampo(m, "Base IRRF:", ondeC);
        c.nfLido = true;
      } else if (soRotulos(l)) {
        continue;
      } else if (c.proventos != null) {
        c.observacoes.push(textoLinha(l)); // depois do ND: texto livre do bloco
      } else {
        c.rubricas.push(...rubricasDaLinha(l, ondeC));
      }
    }
  }
  fechar();

  if (!cab.calculo) throw new ErroExtratoMensal('Cabeçalho sem "Cálculo:". Não parece um Extrato Mensal.');
  if (cab.calculo !== CALCULO_ACEITO) {
    throw new ErroExtratoMensal(
      `Este PDF é do cálculo "${cab.calculo}". Só é aceito o Extrato Mensal de "${CALCULO_ACEITO}" (13º, férias e adiantamento não entram aqui).`,
    );
  }
  if (!cab.competencia) throw new ErroExtratoMensal('Cabeçalho sem "Competência:".');
  if (totais.proventos == null || totais.descontos == null || totais.liquido == null) {
    throw new ErroExtratoMensal(
      'Totais gerais não encontrados ("Total Geral Proventos", "Total Geral Descontos", "Líquido Geral"). O PDF pode estar incompleto.',
    );
  }
  if (colaboradores.length === 0) throw new ErroExtratoMensal("Nenhum colaborador encontrado no PDF.");

  return {
    ...cab,
    totalProventos: totais.proventos,
    totalDescontos: totais.descontos,
    liquidoGeral: totais.liquido,
    colaboradores,
  };
}

// ---------- Integridade ----------

export type TotaisColaborador = { proventos: number; descontos: number; liquido: number };

/** Proventos = soma dos P; descontos = soma dos D; líquido = proventos − descontos. */
export function totaisDasRubricas(
  rubricas: readonly Pick<RubricaExtrato, "tipo" | "valor">[],
): TotaisColaborador {
  const p = somaCentavos(rubricas.filter((r) => r.tipo === "P").map((r) => r.valor));
  const d = somaCentavos(rubricas.filter((r) => r.tipo === "D").map((r) => r.valor));
  return { proventos: deCentavos(p), descontos: deCentavos(d), liquido: deCentavos(p - d) };
}

type ColaboradorConferivel = Pick<
  ColaboradorExtrato,
  "codigo" | "nome" | "rubricas" | "proventos" | "descontos" | "liquido"
>;

/** Lista de falhas de integridade (vazia = folha íntegra). Usada no navegador e no servidor. */
export function conferirIntegridade(folha: {
  totalProventos: number;
  totalDescontos: number;
  liquidoGeral: number;
  colaboradores: readonly ColaboradorConferivel[];
}): string[] {
  const erros: string[] = [];
  const dif = (a: number, b: number) => formatarReais(subtraiReais(a, b));
  for (const c of folha.colaboradores) {
    const quem = `Colaborador ${nomeColaborador(c)}`;
    const t = totaisDasRubricas(c.rubricas);
    if (paraCentavos(t.proventos) !== paraCentavos(c.proventos)) {
      erros.push(
        `${quem}: soma dos proventos (P) ${formatarReais(t.proventos)} ≠ Proventos ${formatarReais(c.proventos)} (diferença ${dif(t.proventos, c.proventos)}).`,
      );
    }
    if (paraCentavos(t.descontos) !== paraCentavos(c.descontos)) {
      erros.push(
        `${quem}: soma dos descontos (D) ${formatarReais(t.descontos)} ≠ Descontos ${formatarReais(c.descontos)} (diferença ${dif(t.descontos, c.descontos)}).`,
      );
    }
    const liq = subtraiReais(c.proventos, c.descontos);
    if (paraCentavos(liq) !== paraCentavos(c.liquido)) {
      erros.push(
        `${quem}: Proventos − Descontos = ${formatarReais(liq)} ≠ Líquido ${formatarReais(c.liquido)}.`,
      );
    }
  }
  const somaP = somaReais(folha.colaboradores.map((c) => c.proventos));
  const somaD = somaReais(folha.colaboradores.map((c) => c.descontos));
  const somaL = somaReais(folha.colaboradores.map((c) => c.liquido));
  if (paraCentavos(somaL) !== paraCentavos(folha.liquidoGeral)) {
    erros.push(
      `Total: soma dos líquidos ${formatarReais(somaL)} ≠ Líquido Geral ${formatarReais(folha.liquidoGeral)} (diferença ${dif(somaL, folha.liquidoGeral)}).`,
    );
  }
  if (paraCentavos(somaP) !== paraCentavos(folha.totalProventos)) {
    erros.push(
      `Total: soma dos proventos ${formatarReais(somaP)} ≠ Total Geral Proventos ${formatarReais(folha.totalProventos)} (diferença ${dif(somaP, folha.totalProventos)}).`,
    );
  }
  if (paraCentavos(somaD) !== paraCentavos(folha.totalDescontos)) {
    erros.push(
      `Total: soma dos descontos ${formatarReais(somaD)} ≠ Total Geral Descontos ${formatarReais(folha.totalDescontos)} (diferença ${dif(somaD, folha.totalDescontos)}).`,
    );
  }
  return erros;
}

/** Lê e confere: lança ErroExtratoMensal com todas as falhas se a folha não fechar. */
export function importarExtratoMensal(paginas: readonly PaginaItens[]): FolhaExtrato {
  const folha = lerExtratoMensal(paginas);
  const erros = conferirIntegridade(folha);
  if (erros.length) {
    throw new ErroExtratoMensal(`A folha não fecha; nada foi importado.\n${erros.join("\n")}`);
  }
  return folha;
}

/** INSS do mês = rubricas de DESCONTO de código 998 (não entram 826, 989, 843…). */
export function inssDoColaborador(c: { rubricas: readonly Pick<RubricaExtrato, "tipo" | "codigo" | "valor">[] }): number {
  return somaReais(c.rubricas.filter((r) => r.tipo === "D" && r.codigo === CODIGO_INSS).map((r) => r.valor));
}
