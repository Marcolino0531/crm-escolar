// Termo de Confissão de Dívida e Outras Avenças — lógica pura do documento.
//
// Mesma disciplina dos outros modelos do módulo Documentos: nada aqui consulta
// o Sponte nem o banco. O `TermoConfissaoDocumento` montado é exatamente o que
// vai para o PDF e o que fica gravado como snapshot no histórico, então
// reimprimir um termo antigo devolve o mesmo documento assinado.
//
// Este documento NÃO tem integração de escrita com o Sponte: o parcelamento
// aqui é a redação do acordo, não um lançamento financeiro.
//
// Convenção de negrito: o texto usa `**termo**` para marcar os termos jurídicos
// (DEVEDOR, DEVEDORES, CREDOR) que o PDF imprime em negrito.

import { proximoDiaUtil } from "./billing-schedule";
import {
  dataPorExtenso,
  enderecoLinha,
  formatarBRL,
  formatarDataBR,
  formatarNumeroRecibo,
  valorPorExtenso,
  type ColegioRecibo,
} from "./recibos";

/** Aluno citado no termo ("20240765 – GIOVANNA GOMES OLIVEIRA MARON"). */
export interface AlunoTermo {
  alunoId: string;
  matricula: string;
  nome: string;
}

/**
 * Devedor do termo: responsável vindo do Sponte ou pessoa digitada à mão
 * (fiador/parente não cadastrado). Depois de selecionado, os dois casos são
 * tratados igual — o documento só imprime a qualificação.
 */
export interface DevedorTermo {
  id: string;
  nome: string;
  cpf: string;
  dataNascimento: string; // YYYY-MM-DD ("" quando não informado)
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  email: string;
  telefone: string;
  solidario: boolean;
  origem: "sponte" | "manual";
}

export interface TestemunhaTermo {
  nome: string;
  cpf: string;
}

export interface ParcelaTermo {
  numero: number;
  valor: number;
  vencimento: string; // YYYY-MM-DD, já ajustado para dia útil
}

export const FORMA_PAGAMENTO_PADRAO = "via boletos bancários enviados por email";

export function devedorVazio(id: string): DevedorTermo {
  return {
    id,
    nome: "",
    cpf: "",
    dataNascimento: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: "",
    email: "",
    telefone: "",
    solidario: true,
    origem: "manual",
  };
}

// ─── Parcelamento ───────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * "YYYY-MM-DD" somado de `meses`, preservando o dia quando ele existe no mês
 * de destino e caindo no último dia do mês quando não existe (31/01 + 1 mês =
 * 28/02). Aritmética só sobre os componentes da string: independe do fuso.
 */
export function addMesesYMD(ymd: string, meses: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = (y * 12 + (m - 1) + meses) | 0;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${ano}-${pad2(mes + 1)}-${pad2(Math.min(d, ultimoDia))}`;
}

/**
 * Parcelas do acordo: valor total dividido pela quantidade EM CENTAVOS, com a
 * diferença da divisão inexata jogada na última parcela (a soma das parcelas é
 * sempre exatamente o total confessado). O vencimento é o mesmo dia da primeira
 * parcela em cada mês seguinte e, caindo em sábado, domingo ou feriado
 * nacional, rola para o próximo dia útil — inclusive o da primeira parcela.
 */
export function calcularParcelasTermo(
  total: number,
  quantidade: number,
  primeiroVencimento: string,
): ParcelaTermo[] {
  const totalCentavos = Math.round((Number.isFinite(total) ? total : 0) * 100);
  const qtd = Math.max(0, Math.trunc(quantidade));
  if (totalCentavos <= 0 || qtd === 0) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiroVencimento)) return [];

  const base = Math.floor(totalCentavos / qtd);
  const parcelas: ParcelaTermo[] = [];
  for (let i = 0; i < qtd; i++) {
    const centavos = i === qtd - 1 ? totalCentavos - base * (qtd - 1) : base;
    parcelas.push({
      numero: i + 1,
      valor: centavos / 100,
      vencimento: proximoDiaUtil(addMesesYMD(primeiroVencimento, i)),
    });
  }
  return parcelas;
}

/** Soma das parcelas, em centavos, para conferir com o total confessado. */
export function totalParcelasTermo(parcelas: readonly ParcelaTermo[]): number {
  return parcelas.reduce((acc, p) => acc + Math.round(p.valor * 100), 0) / 100;
}

// ─── Redação ────────────────────────────────────────────────────────────────

function juntar(partes: (string | undefined)[], sep: string): string {
  return partes
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(sep);
}

/** "20240765 – NOME DO ALUNO" (cai no AlunoID quando não há matrícula). */
export function linhaAluno(aluno: AlunoTermo): string {
  const codigo = aluno.matricula.trim() || aluno.alunoId.trim();
  return juntar([codigo, aluno.nome.trim().toUpperCase()], " – ");
}

/**
 * Qualificação completa de um devedor, omitindo junto com a vírgula tudo que
 * não foi informado (o termo não pode sair com lacuna).
 */
export function qualificacaoDevedor(d: DevedorTermo): string {
  const partes: string[] = [d.nome.trim().toUpperCase()];
  const nascimento = formatarDataBR(d.dataNascimento);
  if (nascimento) partes.push(`nascido(a) em ${nascimento}`);
  if (d.cpf.trim()) partes.push(`inscrito(a) no CPF sob o n° ${d.cpf.trim()}`);
  const endereco = enderecoLinha(d);
  if (endereco) partes.push(`residente e domiciliado(a) na ${endereco}`);
  if (d.email.trim()) partes.push(`endereço eletrônico ${d.email.trim()}`);
  if (d.telefone.trim()) partes.push(`telefone ${d.telefone.trim()}`);
  return partes.join(", ");
}

/** Identificação do CREDOR (colégio) na abertura do termo. */
export function qualificacaoCredor(colegio: ColegioRecibo): string {
  const nome = colegio.razaoSocial.trim() || colegio.nomeFantasia.trim();
  const partes: string[] = [nome.toUpperCase()];
  partes.push("pessoa jurídica de direito privado");
  if (colegio.cnpj.trim()) partes.push(`inscrita no CNPJ sob o n° ${colegio.cnpj.trim()}`);
  const endereco = enderecoLinha(colegio);
  if (endereco) partes.push(`com sede na ${endereco}`);
  if (colegio.email.trim()) partes.push(`endereço eletrônico ${colegio.email.trim()}`);
  return partes.join(", ");
}

interface Genero {
  /** "**DEVEDOR**" ou "**DEVEDORES**" */
  devedor: string;
  /** "denominado" / "denominados" */
  denominado: string;
  /** "este" / "estes" */
  este: string;
  /** "se compromete" / "se comprometem" */
  compromete: string;
  /** "renuncia" / "renunciam" */
  renuncia: string;
  /** "procederá" / "procederão" */
  procedera: string;
  plural: boolean;
}

function genero(qtdDevedores: number): Genero {
  const plural = qtdDevedores > 1;
  return {
    devedor: plural ? "**DEVEDORES**" : "**DEVEDOR**",
    denominado: plural ? "denominados" : "denominado",
    este: plural ? "estes" : "este",
    compromete: plural ? "se comprometem" : "se compromete",
    renuncia: plural ? "renunciam" : "renuncia",
    procedera: plural ? "procederão" : "procederá",
    plural,
  };
}

export interface SecaoTermo {
  titulo: string;
  paragrafos: string[];
}

export interface TermoConfissaoDocumento {
  numero: string;
  dataDocumento: string; // YYYY-MM-DD escolhida pelo usuário
  dataExtenso: string; // "Belo Horizonte, 14 de agosto de 2026"
  colegio: ColegioRecibo;
  representanteNome: string;
  representanteOab: string;
  alunos: AlunoTermo[];
  linhasAlunos: string[];
  devedores: DevedorTermo[];
  testemunhas: TestemunhaTermo[];
  anoLetivo: string;
  formaPagamento: string;
  valorTotal: number;
  valorFormatado: string;
  valorExtenso: string;
  parcelas: ParcelaTermo[];
  abertura: string;
  secoes: SecaoTermo[];
  enderecoColegio: string;
  contatoColegio: string;
  plural: boolean;
}

export interface MontarTermoInput {
  numero: number;
  dataDocumento: string;
  colegio: ColegioRecibo;
  alunos: readonly AlunoTermo[];
  devedores: readonly DevedorTermo[];
  testemunhas: readonly TestemunhaTermo[];
  anoLetivo: string;
  formaPagamento: string;
  valorTotal: number;
  parcelas: readonly ParcelaTermo[];
}

function textoAbertura(input: MontarTermoInput, g: Genero): string {
  const representante = juntar(
    [
      input.colegio.representanteNome?.trim(),
      input.colegio.representanteOab?.trim()
        ? `OAB-MG ${input.colegio.representanteOab.trim()}`
        : "",
    ],
    ", ",
  );
  const qualificacoes = input.devedores.map(qualificacaoDevedor).join("; e ");
  return (
    `${qualificacaoCredor(input.colegio)}, doravante denominado **CREDOR**` +
    (representante ? `, REPRESENTADO por ${representante}` : "") +
    `, e de outro lado, ${g.denominado} ${g.devedor}, ${qualificacoes}, ` +
    "resolvem celebrar entre si o presente Termo de Confissão de Dívida e outras avenças, " +
    "conforme disposições abaixo:"
  );
}

function secoes(input: MontarTermoInput, g: Genero, valorComExtenso: string): SecaoTermo[] {
  const ano = input.anoLetivo.trim();
  const forma = input.formaPagamento.trim();
  const qtd = input.parcelas.length;
  const solidariedade = g.plural
    ? " Os **DEVEDORES** respondem solidariamente pela integralidade da dívida aqui confessada, " +
      "nos termos dos arts. 264 e seguintes do Código Civil."
    : "";

  return [
    {
      titulo: "1 – DAS CONSIDERAÇÕES PRÉVIAS",
      paragrafos: [
        `Considerando que o **CREDOR** celebrou negócios jurídicos de serviços educacionais para ` +
          `${g.plural ? "os" : "o"} ${g.devedor} sem que ${g.este} ${
            g.plural ? "tenham" : "tenha"
          } realizado o pagamento do valor acordado, restando inadimplido o valor total de ` +
          `${valorComExtenso}.`,
        "Considerando que, uma vez caracterizado o inadimplemento mencionado, desejam as partes " +
          "firmar o presente Termo de Confissão e Assunção de Dívidas.",
      ],
    },
    {
      titulo: "2 – DO OBJETO",
      paragrafos: [
        `O objeto do presente instrumento particular será a Confissão/Assunção da dívida ` +
          `mencionada ${g.plural ? "pelos" : "pelo"} ${g.devedor}, considerando-se o valor total ` +
          `do débito atualizado referente as mensalidades em aberto do ano letivo de ` +
          `${ano || "[ano letivo]"}, qual seja, ${valorComExtenso}.`,
        `${g.plural ? "Os" : "O"} ${g.devedor} ${g.procedera} com o pagamento do débito da ` +
          `seguinte forma: ${forma}${
            qtd > 0
              ? `, em ${qtd} (${qtd === 1 ? "uma" : String(qtd)}) parcela${
                  qtd === 1 ? "" : "s"
                }, conforme o quadro de vencimentos abaixo`
              : ""
          }.`,
      ],
    },
    {
      titulo: "3 – DAS OBRIGAÇÕES",
      paragrafos: [
        `${g.plural ? "Os" : "O"} ${g.devedor} ${g.compromete} ao pagamento do montante integral ` +
          "da dívida aqui confessada, nas datas e nos valores previstos na cláusula anterior." +
          solidariedade,
        `${g.plural ? "Os" : "O"} ${g.devedor} ${g.renuncia} a todos e quaisquer direitos ` +
          "referentes aos títulos de crédito e às cobranças que deram origem à dívida ora " +
          "confessada, reconhecendo-a como líquida, certa e exigível.",
        "O **CREDOR** se compromete, após o pagamento integral, a dar plena e geral quitação a " +
          "presente dívida.",
      ],
    },
    {
      titulo: "4 – DO LOCAL DO CUMPRIMENTO",
      paragrafos: [
        "4.1 O pagamento das parcelas será realizado na forma prevista neste instrumento, " +
          "considerando-se como local do cumprimento da obrigação a Comarca de Belo Horizonte, " +
          "Minas Gerais.",
      ],
    },
    {
      titulo: "5 – DA CLÁUSULA PENAL",
      paragrafos: [
        "Em caso de atraso no pagamento de qualquer das parcelas, incidirá sobre o valor em atraso " +
          "multa de mora de 2% (dois por cento), juros de mora de 1% (um por cento) ao mês, " +
          "calculados pro rata die, e correção monetária.",
        `Caso o atraso ultrapasse 15 (quinze) dias corridos, vencerão antecipadamente todas as ` +
          `parcelas vincendas, tornando-se imediatamente exigível o saldo devedor remanescente, ` +
          `sobre o qual incidirá cláusula penal de 20% (vinte por cento), sem prejuízo da multa e ` +
          `dos juros de mora previstos acima.`,
        `Na hipótese de inadimplemento, fica o **CREDOR** autorizado a promover o protesto do ` +
          `presente título e a inclusão do nome ${
            g.plural ? "dos **DEVEDORES**" : "do **DEVEDOR**"
          } nos cadastros de proteção ao crédito (SPC/SERASA), bem como a executá-lo ` +
          `judicialmente.`,
      ],
    },
    {
      titulo: "6 – DAS DISPOSIÇÕES FINAIS",
      paragrafos: [
        "6.1 As partes elegem o foro da Cidade de Belo Horizonte – MG para dirimir quaisquer " +
          "controvérsias oriundas do presente instrumento, com renúncia expressa a qualquer " +
          "outro, por mais privilegiado que seja.",
        "6.2 O presente instrumento é firmado em caráter irrevogável e irretratável, obrigando as " +
          "partes, seus herdeiros e sucessores, e constitui título dotado de força executiva, nos " +
          "termos do art. 784, inc. III, do Novo Código de Processo Civil.",
      ],
    },
  ];
}

export function montarTermoConfissao(input: MontarTermoInput): TermoConfissaoDocumento {
  const g = genero(input.devedores.length);
  const valorFormatado = formatarBRL(input.valorTotal);
  const valorExtenso = valorPorExtenso(input.valorTotal);
  const valorComExtenso = `${valorFormatado} (${valorExtenso})`;
  const cidade = input.colegio.cidade.trim();

  return {
    numero: formatarNumeroRecibo(input.numero, input.dataDocumento),
    dataDocumento: input.dataDocumento,
    dataExtenso: juntar([cidade, dataPorExtenso(input.dataDocumento)], ", "),
    colegio: input.colegio,
    representanteNome: input.colegio.representanteNome?.trim() ?? "",
    representanteOab: input.colegio.representanteOab?.trim() ?? "",
    alunos: [...input.alunos],
    linhasAlunos: input.alunos.map(linhaAluno),
    devedores: [...input.devedores],
    testemunhas: [...input.testemunhas],
    anoLetivo: input.anoLetivo.trim(),
    formaPagamento: input.formaPagamento.trim(),
    valorTotal: input.valorTotal,
    valorFormatado,
    valorExtenso,
    parcelas: [...input.parcelas],
    abertura: textoAbertura(input, g),
    secoes: secoes(input, g, valorComExtenso),
    enderecoColegio: enderecoLinha(input.colegio),
    contatoColegio: juntar(
      [input.colegio.telefone, input.colegio.email, input.colegio.site],
      " · ",
    ),
    plural: g.plural,
  };
}

/** O que fica gravado no histórico: tudo que o PDF precisa para sair igual. */
export interface TermoConfissaoSnapshot {
  colegio: ColegioRecibo;
  alunos: AlunoTermo[];
  devedores: DevedorTermo[];
  testemunhas: TestemunhaTermo[];
  anoLetivo: string;
  formaPagamento: string;
  valorTotal: number;
  parcelas: ParcelaTermo[];
}

export function montarTermoDoSnapshot(
  numero: number,
  dataDocumento: string,
  snap: TermoConfissaoSnapshot,
): TermoConfissaoDocumento {
  return montarTermoConfissao({
    numero,
    dataDocumento,
    colegio: snap.colegio,
    alunos: snap.alunos ?? [],
    devedores: snap.devedores ?? [],
    testemunhas: snap.testemunhas ?? [],
    anoLetivo: snap.anoLetivo ?? "",
    formaPagamento: snap.formaPagamento ?? "",
    valorTotal: Number(snap.valorTotal ?? 0),
    parcelas: snap.parcelas ?? [],
  });
}

/**
 * Responsável do Sponte virando devedor do termo. `solidario` é decidido pela
 * ordem na tela (o primeiro selecionado é o devedor principal).
 */
export function devedorDeResponsavel(
  r: {
    responsavelId: string;
    nome: string;
    cpf: string;
    dataNascimento: string;
    endereco: string;
    numero: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
    email: string;
    telefone: string;
  },
  solidario: boolean,
): DevedorTermo {
  return {
    id: `sponte:${r.responsavelId}`,
    nome: r.nome,
    cpf: r.cpf,
    dataNascimento: r.dataNascimento,
    endereco: r.endereco,
    numero: r.numero,
    complemento: "",
    bairro: r.bairro,
    cidade: r.cidade,
    uf: r.uf,
    cep: r.cep,
    email: r.email,
    telefone: r.telefone,
    solidario,
    origem: "sponte",
  };
}

/** Impedimentos de emissão (lista vazia = pode gerar). */
export function validarTermoConfissao(input: {
  colegio: ColegioRecibo | null;
  alunos: readonly AlunoTermo[];
  devedores: readonly DevedorTermo[];
  anoLetivo: string;
  formaPagamento: string;
  valorTotal: number;
  quantidadeParcelas: number;
  primeiroVencimento: string;
  dataDocumento: string;
}): string[] {
  const erros: string[] = [];
  if (!input.colegio || !input.colegio.razaoSocial.trim()) {
    erros.push("Cadastre a razão social do colégio em Configurações → Dados dos Colégios.");
  }
  if (!input.colegio || !input.colegio.cnpj.trim()) {
    erros.push("Cadastre o CNPJ do colégio em Configurações → Dados dos Colégios.");
  }
  if (!input.colegio?.representanteNome?.trim()) {
    erros.push(
      "Cadastre quem representa o CREDOR em Configurações → Dados dos Colégios (nome e OAB).",
    );
  }
  if (input.alunos.length === 0) erros.push("Selecione ao menos um aluno.");
  if (input.devedores.length === 0) {
    erros.push("Selecione ao menos um responsável como DEVEDOR.");
  }
  for (const d of input.devedores) {
    if (!d.nome.trim()) erros.push("Informe o nome completo de todos os devedores.");
    if (!d.cpf.trim()) erros.push(`Informe o CPF de ${d.nome.trim() || "todos os devedores"}.`);
  }
  if (!/^\d{4}$/.test(input.anoLetivo.trim())) {
    erros.push("Informe o ano letivo de referência do débito (ex.: 2025).");
  }
  if (!input.formaPagamento.trim()) erros.push("Informe a forma de pagamento.");
  if (Math.round(input.valorTotal * 100) <= 0) erros.push("Informe o valor total da dívida.");
  if (input.quantidadeParcelas < 1) erros.push("Informe o número de parcelas.");
  if (!formatarDataBR(input.primeiroVencimento)) {
    erros.push("Informe a data de vencimento da 1ª parcela.");
  }
  if (!formatarDataBR(input.dataDocumento)) erros.push("Informe a data do documento.");
  return [...new Set(erros)];
}

export function nomeArquivoTermoConfissao(doc: TermoConfissaoDocumento): string {
  const alvo = (doc.alunos[0]?.nome ?? doc.devedores[0]?.nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
  return `termo-confissao-divida-${doc.numero.replace("/", "-")}-${alvo || "documento"}.pdf`;
}
