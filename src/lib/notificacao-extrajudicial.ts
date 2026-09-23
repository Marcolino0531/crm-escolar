// Notificação Extrajudicial — texto e validação (puro). O PDF fica em
// notificacao-extrajudicial-pdf.ts; o débito vem de cobranca-casos
// (`montarDemonstrativo`, regra oficial de billing-debt).

import {
  enderecoResponsavelLinha,
  formatarBRL,
  formatarCpf,
  formatarDataBR,
  type DemonstrativoDebito,
  type EnderecoResponsavel,
} from "@/lib/cobranca-casos";
import { dataPorExtenso, enderecoLinha, type ColegioRecibo } from "@/lib/recibos";

export const ASSINATURA_NOTIFICACAO = { nome: "Sérgio Marcolino", cargo: "Diretor" } as const;

/** Campos de documentos_colegios obrigatórios para emitir a notificação. */
export const CAMPOS_OBRIGATORIOS_NOTIFICACAO: readonly {
  campo: keyof ColegioRecibo;
  label: string;
}[] = [
  { campo: "razaoSocial", label: "Razão social" },
  { campo: "cnpj", label: "CNPJ" },
  { campo: "endereco", label: "Endereço" },
  { campo: "numero", label: "Número" },
  { campo: "bairro", label: "Bairro" },
  { campo: "cidade", label: "Cidade" },
  { campo: "uf", label: "UF" },
  { campo: "cep", label: "CEP" },
  { campo: "telefone", label: "Telefone" },
  { campo: "email", label: "E-mail" },
];

/** Rótulos dos campos da unidade que faltam em "Dados dos Colégios". */
export function camposFaltantesColegio(colegio: ColegioRecibo): string[] {
  return CAMPOS_OBRIGATORIOS_NOTIFICACAO.filter(
    ({ campo }) => !String(colegio[campo] ?? "").trim(),
  ).map((c) => c.label);
}

export interface NotificacaoInput {
  colegio: ColegioRecibo;
  responsavel: {
    nome: string;
    cpf: string;
    endereco: EnderecoResponsavel | null;
  };
  alunos: readonly string[];
  demonstrativo: DemonstrativoDebito;
  /** Datas (YYYY-MM-DD) de envio das 5 mensagens, em ordem. */
  datasMensagens: readonly string[];
  dataEmissao: string; // YYYY-MM-DD
}

export interface NotificacaoDocumento {
  titulo: string;
  qualificacao: string[];
  saudacao: string;
  paragrafosAntes: string[];
  tabela: {
    descricao: string;
    vencimento: string;
    original: string;
    multa: string;
    juros: string;
    atualizado: string;
  }[];
  linhaTotal: string;
  paragrafosDepois: string[];
  fecho: string;
  assinatura: string[];
  total: number;
}

function listar(itens: readonly string[]): string {
  const v = itens.filter(Boolean);
  if (v.length <= 1) return v[0] ?? "";
  return `${v.slice(0, -1).join(", ")} e ${v[v.length - 1]}`;
}

/** Monta o texto completo da notificação (colchetes do modelo preenchidos). */
export function montarNotificacao(input: NotificacaoInput): NotificacaoDocumento {
  const { colegio, responsavel, demonstrativo } = input;
  const razao = colegio.razaoSocial.trim() || colegio.nomeFantasia.trim();
  const datas = input.datasMensagens.filter(Boolean).map(formatarDataBR);
  const alunos = input.alunos.filter(Boolean).join(", ");

  const qualificacao = [
    `Notificante: ${razao}, inscrita no CNPJ sob o nº ${colegio.cnpj.trim()}, com sede em ${enderecoLinha(colegio)}.`,
    `Notificado(a): ${responsavel.nome}, CPF nº ${formatarCpf(responsavel.cpf) || "não informado"}, residente em ${
      enderecoResponsavelLinha(responsavel.endereco) || "endereço não informado"
    }.`,
    `Referente ao(s) aluno(s): ${alunos}.`,
  ];

  const paragrafosAntes = [
    "Pela presente, e na condição de responsável financeiro(a) pelo contrato de prestação de serviços educacionais firmado com esta instituição, fica V.Sa. formalmente NOTIFICADO(A) da existência dos débitos abaixo, vencidos e não pagos até a presente data:",
  ];

  const tabela = demonstrativo.parcelas.map((p) => ({
    descricao: input.alunos.length > 1 ? `${p.descricao} — ${p.aluno}` : p.descricao,
    vencimento: formatarDataBR(p.vencimento),
    original: formatarBRL(p.original),
    multa: formatarBRL(p.multa),
    juros: formatarBRL(p.juros),
    atualizado: formatarBRL(p.atualizado),
  }));

  const linhaTotal = `Total atualizado até ${formatarDataBR(input.dataEmissao)}: ${formatarBRL(demonstrativo.total)}`;

  const contatos = listar([colegio.telefone.trim(), colegio.email.trim()]);

  const paragrafosDepois = [
    "Os valores foram atualizados conforme o contrato, com multa de 2% sobre a parcela vencida e juros de mora de 1% ao mês, proporcionais aos dias de atraso.",
    `Registramos que esta instituição buscou a solução amigável do débito por meio de contatos realizados nos dias ${listar(datas)}, sem que houvesse a regularização.`,
    `Assim, concedemos o prazo de 10 (dez) dias corridos, contados do recebimento desta, para o pagamento do débito ou para o contato visando a formalização de acordo, pelos canais: ${contatos}.`,
    "Decorrido esse prazo sem manifestação, esta instituição adotará as medidas legais cabíveis para a cobrança do débito, incluindo o protesto dos títulos, a inclusão do nome do(a) devedor(a) nos cadastros de proteção ao crédito e o ajuizamento da ação judicial competente, com acréscimo das custas processuais e dos honorários advocatícios.",
    "Caso o pagamento já tenha sido efetuado, pedimos que desconsidere esta notificação e nos encaminhe o comprovante.",
    "Esta notificação é enviada de forma reservada e exclusivamente ao(à) responsável financeiro(a), sem qualquer exposição do(s) aluno(s).",
  ];

  return {
    titulo: "NOTIFICAÇÃO EXTRAJUDICIAL",
    qualificacao,
    saudacao: "Prezado(a) Senhor(a),",
    paragrafosAntes,
    tabela,
    linhaTotal,
    paragrafosDepois,
    fecho: `Belo Horizonte, ${dataPorExtenso(input.dataEmissao)}.`,
    assinatura: [ASSINATURA_NOTIFICACAO.nome, ASSINATURA_NOTIFICACAO.cargo, razao],
    total: demonstrativo.total,
  };
}

/** Texto corrido (para snapshot/histórico e testes). */
export function notificacaoComoTexto(doc: NotificacaoDocumento): string {
  return [
    doc.titulo,
    "",
    ...doc.qualificacao,
    "",
    doc.saudacao,
    "",
    ...doc.paragrafosAntes,
    "",
    ...doc.tabela.map(
      (l) =>
        `${l.descricao} | ${l.vencimento} | ${l.original} | ${l.multa} | ${l.juros} | ${l.atualizado}`,
    ),
    doc.linhaTotal,
    "",
    ...doc.paragrafosDepois.flatMap((p) => [p, ""]),
    doc.fecho,
    "",
    ...doc.assinatura,
  ].join("\n");
}
