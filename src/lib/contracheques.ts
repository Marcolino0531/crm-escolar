// Lógica pura do envio de contracheques (RH).
//
// A contabilidade manda UM PDF com uma página por funcionário. Aqui mora a
// parte determinística do fluxo: a partir do texto de cada página, descobrir de
// qual funcionário cadastrado ela é, e classificar o que impede o envio
// automático (página sem correspondência, funcionário sem email, sem CPF —
// porque a senha do arquivo vem do CPF).
//
// Nada aqui lê PDF nem envia email: a extração de texto está em
// `contracheques.pdf.ts` (client, pdfjs) e o envio em `contracheques.functions.ts`.

export const DIGITOS_SENHA_CPF = 5;

export type FuncionarioContracheque = {
  id: string;
  nomeCompleto: string;
  cpf: string;
  email: string;
  unidade: string;
  ativo: boolean;
};

export type PaginaPdf = {
  pagina: number; // 1-based, como o usuário vê no leitor de PDF
  texto: string;
};

export type StatusPagina = "pronta" | "sem_correspondencia" | "sem_email" | "sem_cpf";

export type OrigemVinculo = "exata" | "parcial" | "manual";

export type PaginaContracheque = {
  pagina: number;
  texto: string;
  funcionarioId: string | null;
  funcionarioNome: string;
  email: string;
  cpf: string;
  status: StatusPagina;
  origem: OrigemVinculo | null;
  duplicada: boolean;
};

export type ResumoConferencia = {
  total: number;
  prontas: number;
  semCorrespondencia: number;
  semEmail: number;
  semCpf: number;
  duplicadas: number;
};

// Conectivos de nome brasileiro não identificam ninguém; entram no casamento
// exato (o nome inteiro), mas são ignorados na contagem de tokens do parcial.
const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e"]);

export function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function tokensDoNome(nome: string): string[] {
  return normalizarTexto(nome)
    .split(" ")
    .filter((t) => t.length > 1 && !CONECTIVOS.has(t.toLowerCase()));
}

export function somenteDigitos(valor: string): string {
  return (valor ?? "").replace(/\D+/g, "");
}

// Senha do PDF: primeiros dígitos do CPF (padrão usual em contracheque).
export function senhaDoCpf(cpf: string, digitos: number = DIGITOS_SENHA_CPF): string | null {
  const limpo = somenteDigitos(cpf);
  if (limpo.length < digitos) return null;
  return limpo.slice(0, digitos);
}

function statusDoFuncionario(f: FuncionarioContracheque): StatusPagina {
  if (!f.email.trim()) return "sem_email";
  if (!senhaDoCpf(f.cpf)) return "sem_cpf";
  return "pronta";
}

function vincular(
  pagina: PaginaPdf,
  funcionario: FuncionarioContracheque | null,
  origem: OrigemVinculo | null,
): PaginaContracheque {
  if (!funcionario) {
    return {
      pagina: pagina.pagina,
      texto: pagina.texto,
      funcionarioId: null,
      funcionarioNome: "",
      email: "",
      cpf: "",
      status: "sem_correspondencia",
      origem: null,
      duplicada: false,
    };
  }
  return {
    pagina: pagina.pagina,
    texto: pagina.texto,
    funcionarioId: funcionario.id,
    funcionarioNome: funcionario.nomeCompleto,
    email: funcionario.email.trim(),
    cpf: funcionario.cpf,
    status: statusDoFuncionario(funcionario),
    origem,
    duplicada: false,
  };
}

// Ordem de preferência entre candidatos com o mesmo nome: ativo antes de
// desligado (contracheque de desligado é exceção) e, empatando, nome mais longo
// (mais específico) primeiro.
function ordenarCandidatos(funcionarios: readonly FuncionarioContracheque[]) {
  return [...funcionarios].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return b.nomeCompleto.length - a.nomeCompleto.length;
  });
}

// Casamento de UMA página: nome completo como substring do texto normalizado
// (o PDF costuma trazer o nome exatamente como no cadastro) e, na falta disso,
// casamento parcial por tokens — com primeiro e último nome obrigatórios, para
// não confundir irmãos/homônimos parciais ("Ana Maria Souza" × "Ana Souza Lima").
export function identificarFuncionarioDaPagina(
  texto: string,
  funcionarios: readonly FuncionarioContracheque[],
): { funcionario: FuncionarioContracheque; origem: OrigemVinculo } | null {
  const alvo = normalizarTexto(texto);
  if (!alvo) return null;

  const candidatos = ordenarCandidatos(funcionarios);

  for (const f of candidatos) {
    const nome = normalizarTexto(f.nomeCompleto);
    if (nome && alvo.includes(nome)) return { funcionario: f, origem: "exata" };
  }

  let melhor: { funcionario: FuncionarioContracheque; score: number } | null = null;
  let empatado = false;

  for (const f of candidatos) {
    const tokens = tokensDoNome(f.nomeCompleto);
    if (tokens.length < 2) continue;

    const primeiro = tokens[0];
    const ultimo = tokens[tokens.length - 1];
    if (!alvo.includes(primeiro) || !alvo.includes(ultimo)) continue;

    const presentes = tokens.filter((t) => alvo.includes(t)).length;
    const score = presentes / tokens.length;
    if (score < 0.75) continue;

    if (!melhor || score > melhor.score) {
      melhor = { funcionario: f, score };
      empatado = false;
    } else if (score === melhor.score && melhor.funcionario.id !== f.id) {
      empatado = true;
    }
  }

  // Empate real é ambiguidade: melhor devolver "sem correspondência" e deixar o
  // usuário escolher na conferência do que enviar contracheque para o errado.
  if (!melhor || empatado) return null;
  return { funcionario: melhor.funcionario, origem: "parcial" };
}

// Marca como duplicada toda página vinculada a um funcionário que aparece em
// mais de uma página (PDF com página repetida, ou casamento errado).
function marcarDuplicadas(paginas: readonly PaginaContracheque[]): PaginaContracheque[] {
  const contagem = new Map<string, number>();
  for (const p of paginas) {
    if (!p.funcionarioId) continue;
    contagem.set(p.funcionarioId, (contagem.get(p.funcionarioId) ?? 0) + 1);
  }
  return paginas.map((p) => ({
    ...p,
    duplicada: p.funcionarioId ? (contagem.get(p.funcionarioId) ?? 0) > 1 : false,
  }));
}

export function conferirPaginas(
  paginas: readonly PaginaPdf[],
  funcionarios: readonly FuncionarioContracheque[],
): PaginaContracheque[] {
  const vinculadas = paginas.map((p) => {
    const achado = identificarFuncionarioDaPagina(p.texto, funcionarios);
    return vincular(p, achado?.funcionario ?? null, achado?.origem ?? null);
  });
  return marcarDuplicadas(vinculadas);
}

export function corrigirVinculo(
  paginas: readonly PaginaContracheque[],
  pagina: number,
  funcionario: FuncionarioContracheque | null,
): PaginaContracheque[] {
  const atualizadas = paginas.map((p) =>
    p.pagina === pagina
      ? vincular({ pagina: p.pagina, texto: p.texto }, funcionario, funcionario ? "manual" : null)
      : p,
  );
  return marcarDuplicadas(atualizadas);
}

export function removerPagina(
  paginas: readonly PaginaContracheque[],
  pagina: number,
): PaginaContracheque[] {
  return marcarDuplicadas(paginas.filter((p) => p.pagina !== pagina));
}

export function paginasEnviaveis(paginas: readonly PaginaContracheque[]): PaginaContracheque[] {
  return paginas.filter((p) => p.status === "pronta" && p.funcionarioId !== null);
}

export function resumirConferencia(paginas: readonly PaginaContracheque[]): ResumoConferencia {
  return {
    total: paginas.length,
    prontas: paginas.filter((p) => p.status === "pronta").length,
    semCorrespondencia: paginas.filter((p) => p.status === "sem_correspondencia").length,
    semEmail: paginas.filter((p) => p.status === "sem_email").length,
    semCpf: paginas.filter((p) => p.status === "sem_cpf").length,
    duplicadas: paginas.filter((p) => p.duplicada).length,
  };
}

// ---------- Falhas de leitura do PDF ----------
//
// pdfjs sinaliza cada problema de um jeito diferente e o motivo real é o que o
// usuário precisa saber para resolver (remover a senha, pedir o PDF com texto,
// dividir o arquivo). A classificação é pura: recebe o erro e devolve o motivo.

export type MotivoFalhaPdf =
  | "senha"
  | "senha_incorreta"
  | "tamanho"
  | "invalido"
  | "sem_texto"
  | "desconhecido";

function nomeDoErro(erro: unknown): string {
  if (typeof erro !== "object" || erro === null) return "";
  const e = erro as { name?: unknown };
  return typeof e.name === "string" ? e.name : "";
}

function mensagemDoErro(erro: unknown): string {
  if (typeof erro !== "object" || erro === null) return String(erro ?? "");
  const e = erro as { message?: unknown };
  return typeof e.message === "string" ? e.message : "";
}

export function classificarErroPdf(erro: unknown): MotivoFalhaPdf {
  const nome = nomeDoErro(erro);
  const msg = mensagemDoErro(erro).toLowerCase();

  if (nome === "PasswordException" || msg.includes("password")) {
    // pdfjs: code 1 = senha não informada, code 2 = senha errada.
    const code = (erro as { code?: unknown }).code;
    if (code === 2 || msg.includes("incorrect")) return "senha_incorreta";
    return "senha";
  }
  if (
    nome === "InvalidPDFException" ||
    nome === "MissingPDFException" ||
    nome === "UnexpectedResponseException" ||
    msg.includes("invalid pdf") ||
    msg.includes("file is empty")
  ) {
    return "invalido";
  }
  return "desconhecido";
}

export function mensagemFalhaPdf(
  motivo: MotivoFalhaPdf,
  ctx?: { tamanhoMaximoMb?: number; tamanhoMb?: number; paginas?: number },
): string {
  switch (motivo) {
    case "senha":
      return (
        "Este PDF está protegido por senha. Informe a senha de abertura no campo " +
        '"Senha do PDF" e envie de novo, ou peça à contabilidade um arquivo sem proteção.'
      );
    case "senha_incorreta":
      return "A senha informada não abre este PDF. Confira a senha e tente de novo.";
    case "tamanho": {
      const max = ctx?.tamanhoMaximoMb ?? 0;
      const atual = ctx?.tamanhoMb;
      const tem = atual ? ` O arquivo enviado tem ${atual.toFixed(1)} MB.` : "";
      return `O arquivo excede o tamanho máximo de ${max} MB.${tem} Divida o PDF em partes e envie uma por vez.`;
    }
    case "invalido":
      return "O arquivo não é um PDF válido ou está corrompido. Gere o PDF novamente e tente de novo.";
    case "sem_texto": {
      const n = ctx?.paginas;
      const quantas = n ? `Todas as ${n} páginas` : "O arquivo";
      return (
        `${quantas} vieram sem texto legível — o PDF parece ser uma imagem escaneada. ` +
        "Como não há texto, não é possível identificar o funcionário de cada página; " +
        "peça à contabilidade o PDF original (gerado pelo sistema, não escaneado)."
      );
    }
    default:
      return "Não foi possível ler o PDF. O formato pode não ser suportado pelo leitor.";
  }
}

export const LABEL_STATUS: Record<StatusPagina, string> = {
  pronta: "Pronta para envio",
  sem_correspondencia: "Nome não localizado no RH",
  sem_email: "Funcionário sem email cadastrado",
  sem_cpf: "Funcionário sem CPF (senha do arquivo)",
};

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

// competencia no formato YYYY-MM.
export function competenciaExtenso(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  const indice = Number(mes) - 1;
  if (!ano || indice < 0 || indice > 11) return competencia;
  return `${MESES[indice]}/${ano}`;
}

export function nomeArquivoContracheque(nome: string, competencia: string): string {
  const base = normalizarTexto(nome).toLowerCase().replace(/ /g, "-") || "funcionario";
  return `contracheque-${base}-${competencia}.pdf`;
}

export function assuntoEmailContracheque(competencia: string): string {
  return `Contracheque — ${competenciaExtenso(competencia)}`;
}

function escapeHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function corpoEmailContracheque(input: {
  nome: string;
  competencia: string;
  digitos?: number;
}): { html: string; text: string } {
  const digitos = input.digitos ?? DIGITOS_SENHA_CPF;
  const primeiroNome = input.nome.trim().split(/\s+/)[0] || input.nome.trim();
  const mes = competenciaExtenso(input.competencia);
  const instrucao =
    `O arquivo em anexo está protegido por senha. Para abrir, utilize os ${digitos} primeiros ` +
    `dígitos do seu CPF (somente números, sem pontos ou traço).`;

  const text = [
    `Olá, ${primeiroNome}!`,
    "",
    `Segue em anexo o seu contracheque referente a ${mes}.`,
    "",
    instrucao,
    "",
    "Em caso de divergência, procure o setor de Recursos Humanos.",
    "",
    "Esta é uma mensagem automática do School Hub.",
  ].join("\n");

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.6">',
    `<p>Olá, ${escapeHtml(primeiroNome)}!</p>`,
    `<p>Segue em anexo o seu contracheque referente a <strong>${escapeHtml(mes)}</strong>.</p>`,
    `<p style="background:#f4f6f8;border-left:4px solid #0f766e;padding:10px 12px">${escapeHtml(instrucao)}</p>`,
    "<p>Em caso de divergência, procure o setor de Recursos Humanos.</p>",
    '<p style="color:#6b7280;font-size:12px">Esta é uma mensagem automática do School Hub.</p>',
    "</div>",
  ].join("");

  return { html, text };
}
