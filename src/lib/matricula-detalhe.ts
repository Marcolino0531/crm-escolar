// Seções do detalhe de uma submissão de matrícula, montadas a partir do que
// ficou gravado localmente (payload da submissão + rotina, saúde e documentos).
// A mesma estrutura alimenta o painel da tela e o PDF de impressão, e vale
// também para submissões que falharam no Sponte — nesses casos o payload
// cadastral existe mesmo sem rotina, saúde ou documentos.

import { z } from "zod";
import { MEALS, WEEKDAYS } from "@/lib/diario";
import { DOCUMENTOS_MATRICULA, PERGUNTAS_SAUDE } from "@/lib/matricula-form";
import type {
  DocumentoSubmissao,
  RotinaSubmissao,
  SaudeSubmissao,
} from "@/lib/matriculas.functions";

export interface CampoDetalhe {
  rotulo: string;
  valor: string;
  /** Preenchido só nos documentos: URL assinada para abrir o arquivo. */
  link?: string;
}

export interface SecaoDetalhe {
  titulo: string;
  grupos: { titulo: string | null; campos: CampoDetalhe[] }[];
}

export interface SubmissaoDetalhe {
  submissionId: string | null;
  unidade: string | null;
  alunoNome: string | null;
  alunoCpf: string | null;
  status: string;
  criadoEm: string;
  sponteAlunoId: number | null;
  erro: string | null;
  payload: unknown;
}

export interface EntradaDetalhe {
  submissao: SubmissaoDetalhe;
  rotina: RotinaSubmissao | null;
  saude: SaudeSubmissao | null;
  documentos: DocumentoSubmissao[];
}

const texto = z.string().optional();

const EnderecoLenienteSchema = z
  .object({
    cep: texto,
    numero: texto,
    complemento: texto,
    logradouro: texto,
    bairro: texto,
    cidade: texto,
  })
  .partial();

// O payload gravado é revalidado só na hora de reenviar ao Sponte: aqui ele é
// lido de forma tolerante para que submissões com erro de validação também
// abram no detalhe.
const PayloadLenienteSchema = z
  .object({
    unidade: texto,
    aluno: z
      .object({
        nome: texto,
        dataNascimento: texto,
        cpf: texto,
        rg: texto,
        sexo: texto,
        naturalidade: texto,
        nacionalidade: texto,
        estadoCivil: texto,
        email: texto,
        telefone: texto,
        celular: texto,
        observacao: texto,
        midia: texto,
      })
      .partial()
      .optional(),
    endereco: EnderecoLenienteSchema.optional(),
    responsaveis: z
      .array(
        z
          .object({
            nome: texto,
            parentesco: texto,
            dataNascimento: texto,
            cpf: texto,
            rg: texto,
            sexo: texto,
            profissao: texto,
            email: texto,
            telefone: texto,
            celular: texto,
            responsavelFinanceiro: z.boolean().optional(),
            responsavelDidatico: z.boolean().optional(),
            endereco: EnderecoLenienteSchema.optional(),
          })
          .partial(),
      )
      .optional(),
  })
  .partial();

export type PayloadDetalhe = z.infer<typeof PayloadLenienteSchema>;

export function lerPayloadSubmissao(payload: unknown): PayloadDetalhe {
  const lido = PayloadLenienteSchema.safeParse(payload);
  return lido.success ? lido.data : {};
}

function campo(rotulo: string, valor: string | number | null | undefined): CampoDetalhe {
  const texto = valor === null || valor === undefined ? "" : String(valor).trim();
  return { rotulo, valor: texto === "" ? "—" : texto };
}

function enderecoEmTexto(endereco: PayloadDetalhe["endereco"]): string {
  if (!endereco) return "";
  const linha = [endereco.logradouro, endereco.numero, endereco.complemento]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "")
    .join(", ");
  const cidade = [endereco.bairro, endereco.cidade]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "")
    .join(" · ");
  return [linha, cidade, (endereco.cep ?? "").trim() === "" ? "" : `CEP ${endereco.cep}`]
    .filter((p) => p !== "")
    .join(" — ");
}

function diasEmTexto(dias: number[]): string {
  const nomes = WEEKDAYS.filter((d) => dias.includes(d.value)).map((d) => d.short);
  return nomes.length > 0 ? nomes.join(", ") : "—";
}

function papeisDoResponsavel(r: NonNullable<PayloadDetalhe["responsaveis"]>[number]): string {
  const papeis = [
    r.responsavelFinanceiro === true ? "Responsável financeiro" : "",
    r.responsavelDidatico === true ? "Responsável didático" : "",
  ].filter((p) => p !== "");
  return papeis.join(" · ");
}

function tituloDoResponsavel(
  r: NonNullable<PayloadDetalhe["responsaveis"]>[number],
  indice: number,
): string {
  const parentesco = (r.parentesco ?? "").trim();
  return parentesco === "" ? `Responsável ${indice + 1}` : parentesco;
}

function secaoCadastro(entrada: EntradaDetalhe): SecaoDetalhe {
  const { submissao } = entrada;
  const payload = lerPayloadSubmissao(submissao.payload);
  const aluno = payload.aluno ?? {};
  const responsaveis = payload.responsaveis ?? [];

  const grupos: SecaoDetalhe["grupos"] = [
    {
      titulo: "Submissão",
      campos: [
        campo("Status", submissao.status),
        campo("Recebida em", submissao.criadoEm),
        campo("Unidade", submissao.unidade ?? payload.unidade),
        campo("Protocolo", submissao.submissionId),
        campo("AlunoID no Sponte", submissao.sponteAlunoId),
        campo("Erro", submissao.erro),
      ],
    },
    {
      titulo: "Aluno",
      campos: [
        campo("Nome", aluno.nome ?? submissao.alunoNome),
        campo("Data de nascimento", aluno.dataNascimento),
        campo("CPF", aluno.cpf ?? submissao.alunoCpf),
        campo("RG", aluno.rg),
        campo("Gênero", aluno.sexo),
        campo("Naturalidade", aluno.naturalidade),
        campo("Nacionalidade", aluno.nacionalidade),
        campo("Estado civil", aluno.estadoCivil),
        campo("Email", aluno.email),
        campo("Telefone", aluno.telefone),
        campo("Celular", aluno.celular),
        campo("Observação", aluno.observacao),
      ],
    },
    {
      titulo: "Endereço",
      campos: [
        campo("Endereço", enderecoEmTexto(payload.endereco)),
        campo("Logradouro", payload.endereco?.logradouro),
        campo("Número", payload.endereco?.numero),
        campo("Complemento", payload.endereco?.complemento),
        campo("Bairro", payload.endereco?.bairro),
        campo("Cidade", payload.endereco?.cidade),
        campo("CEP", payload.endereco?.cep),
      ],
    },
  ];

  for (const [indice, r] of responsaveis.entries()) {
    grupos.push({
      titulo: tituloDoResponsavel(r, indice),
      campos: [
        campo("Nome", r.nome),
        campo("Parentesco", r.parentesco),
        campo("Papéis", papeisDoResponsavel(r)),
        campo("CPF", r.cpf),
        campo("RG", r.rg),
        campo("Data de nascimento", r.dataNascimento),
        campo("Sexo", r.sexo),
        campo("Profissão", r.profissao),
        campo("Email", r.email),
        campo("Telefone", r.telefone),
        campo("Celular", r.celular),
        campo("Endereço", enderecoEmTexto(r.endereco)),
      ],
    });
  }

  return { titulo: "Dados do Aluno e Responsáveis", grupos };
}

function secaoRotina(rotina: RotinaSubmissao | null): SecaoDetalhe {
  if (rotina === null)
    return {
      titulo: "Rotina Escolar",
      grupos: [{ titulo: null, campos: [campo("Rotina escolar", "Não enviada")] }],
    };

  const periodos = [
    rotina.periodoManha ? "Manhã" : "",
    rotina.periodoTarde ? "Tarde" : "",
    rotina.horarioEstendido ? "Horário estendido" : "",
  ].filter((p) => p !== "");

  return {
    titulo: "Rotina Escolar",
    grupos: [
      {
        titulo: null,
        campos: [
          campo("Série", rotina.serie),
          campo("Ano letivo", rotina.anoLetivo),
          campo("Início", rotina.dataInicio),
          campo("Origem", rotina.origem),
          campo("Períodos", periodos.join(" · ")),
          campo("Dias da semana", diasEmTexto(rotina.diasAtivos)),
        ],
      },
      {
        titulo: "Horários",
        campos:
          rotina.horarios.length === 0
            ? [campo("Horários", "")]
            : rotina.horarios.map((h) =>
                campo(
                  WEEKDAYS.find((d) => d.value === h.weekday)?.long ?? String(h.weekday),
                  `${h.entrada} às ${h.saida}`,
                ),
              ),
      },
      {
        titulo: "Refeições",
        campos: rotina.semRefeicoes
          ? [campo("Refeições", "Nenhuma refeição contratada")]
          : MEALS.map((m) => campo(m.label, diasEmTexto(rotina.refeicoes[m.key] ?? []))),
      },
    ],
  };
}

function respostaSaude(opcao: string, detalhe: string): string {
  return detalhe.trim() === "" ? opcao : `${opcao} — ${detalhe}`;
}

function secaoSaude(saude: SaudeSubmissao | null): SecaoDetalhe {
  if (saude === null)
    return {
      titulo: "Questionário de Saúde",
      grupos: [{ titulo: null, campos: [campo("Questionário de saúde", "Não enviado")] }],
    };

  const respostas: Record<string, string> = {
    alergia: respostaSaude(saude.alergia, saude.alergiaDetalhe),
    problemaSaude: respostaSaude(saude.problemaSaude, saude.problemaSaudeDetalhe),
    medicamentoContinuo: respostaSaude(saude.medicamentoContinuo, saude.medicamentoContinuoDetalhe),
    planoSaude: respostaSaude(saude.planoSaude, saude.planoSaudeDetalhe),
  };

  return {
    titulo: "Questionário de Saúde",
    grupos: [
      {
        titulo: null,
        campos: [
          campo("Contatos de emergência", saude.contatoEmergencia),
          ...PERGUNTAS_SAUDE.map((p) => campo(p.pergunta, respostas[p.campo])),
          campo("Pessoas autorizadas a buscar", saude.pessoasAutorizadas),
          campo("Cor/raça", saude.corRaca),
          campo("Outras informações", saude.outrasInformacoes),
        ],
      },
    ],
  };
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function secaoDocumentos(documentos: DocumentoSubmissao[]): SecaoDetalhe {
  if (documentos.length === 0)
    return {
      titulo: "Documentos",
      grupos: [{ titulo: null, campos: [campo("Documentos", "Nenhum documento anexado")] }],
    };

  return {
    titulo: "Documentos",
    grupos: [
      {
        titulo: null,
        campos: documentos.map((doc) => {
          const rotulo =
            DOCUMENTOS_MATRICULA.find((d) => d.chave === doc.documento)?.rotulo ?? doc.documento;
          const base = campo(rotulo, `${doc.nomeArquivo} · ${tamanhoLegivel(doc.tamanhoBytes)}`);
          return doc.url === null ? base : { ...base, link: doc.url };
        }),
      },
    ],
  };
}

/** As quatro seções do formulário, na mesma ordem das etapas do /matricula. */
export function montarSecoesDetalhe(entrada: EntradaDetalhe): SecaoDetalhe[] {
  return [
    secaoCadastro(entrada),
    secaoRotina(entrada.rotina),
    secaoSaude(entrada.saude),
    secaoDocumentos(entrada.documentos),
  ];
}
