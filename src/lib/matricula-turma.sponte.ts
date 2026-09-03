// Matrícula do aluno na turma do Sponte (Fase 2), o passo que roda DEPOIS de o
// cadastro do aluno já ter sido criado com sucesso.
//
// Métodos usados (WSAPIEdu):
//   GetCursos       — mapeia a série calculada em CursoID (`Situacao=1`).
//   GetTurmas       — turmas do curso no ano letivo; exige ao menos um filtro.
//   GetMatriculas   — trava anti-duplicidade: contrato do aluno já existente.
//   InsertMatricula — cria o contrato e devolve o ContratoID.
//
// Nada aqui derruba o cadastro do aluno: qualquer falha (série sem curso, turma
// inexistente, erro do Sponte) volta como resultado com status próprio, para a
// secretaria resolver na mão a partir do painel de Matrículas.

import {
  cursoIdDaSerie,
  escolherTurma,
  matriculaConfirmada,
  montarParametrosInsertMatricula,
  textoPendenciaTurma,
  type CursoSponte,
  type StatusMatriculaTurma,
  type TurmaSponte,
  type TurnoTurma,
} from "@/lib/matricula-turma";
import {
  callSponte,
  callSponteMethod,
  checkFault,
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
} from "@/lib/sponte.functions";

interface Credenciais {
  codigoCliente: string;
  token: string;
}

function numero(item: string, tag: string): number | null {
  const n = parseInt(parseXmlValue(item, tag), 10);
  return Number.isFinite(n) ? n : null;
}

export async function buscarCursos(creds: Credenciais): Promise<CursoSponte[]> {
  const xml = await callSponte("GetCursos", "Situacao=1", creds.codigoCliente, creds.token);
  const falha = checkFault(xml);
  if (falha) throw new Error(`GetCursos: ${falha}`);
  return parseXmlList(xml, "wsCurso").flatMap((item) => {
    const cursoId = numero(item, "CursoID");
    if (cursoId === null) return [];
    return [
      {
        cursoId,
        nome: parseXmlValue(item, "Nome"),
        serie: parseXmlValue(item, "Serie"),
      },
    ];
  });
}

export async function buscarTurmas(
  creds: Credenciais,
  filtro: { cursoId: number; anoLetivo: number },
): Promise<TurmaSponte[]> {
  const xml = await callSponte(
    "GetTurmas",
    `AnoLetivo=${filtro.anoLetivo};CursoID=${filtro.cursoId}`,
    creds.codigoCliente,
    creds.token,
  );
  const falha = checkFault(xml);
  if (falha) throw new Error(`GetTurmas: ${falha}`);
  return parseXmlList(xml, "wsTurma").flatMap((item) => {
    const turmaId = numero(item, "TurmaID");
    if (turmaId === null) return [];
    return [
      {
        turmaId,
        nome: parseXmlValue(item, "Nome"),
        cursoId: numero(item, "CursoID") ?? filtro.cursoId,
        curso: parseXmlValue(item, "Curso"),
        anoLetivo: numero(item, "AnoLetivo"),
        situacao: parseXmlValue(item, "Situacao"),
        horario: parseXmlValue(item, "Horario"),
        maxAlunos: numero(item, "MaxAlunos"),
        vagasOcupadas: numero(item, "VagasOcupadas"),
      },
    ];
  });
}

// Todas as turmas do ano letivo (qualquer curso): usada para saber quais turnos
// existem de fato para cada série na Rematrícula.
export async function buscarTurmasDoAno(
  creds: Credenciais,
  anoLetivo: number,
): Promise<TurmaSponte[]> {
  const xml = await callSponte(
    "GetTurmas",
    `AnoLetivo=${anoLetivo}`,
    creds.codigoCliente,
    creds.token,
  );
  const falha = checkFault(xml);
  if (falha) throw new Error(`GetTurmas: ${falha}`);
  return parseXmlList(xml, "wsTurma").flatMap((item) => {
    const turmaId = numero(item, "TurmaID");
    const cursoId = numero(item, "CursoID");
    if (turmaId === null || cursoId === null) return [];
    return [
      {
        turmaId,
        nome: parseXmlValue(item, "Nome"),
        cursoId,
        curso: parseXmlValue(item, "Curso"),
        anoLetivo: numero(item, "AnoLetivo"),
        situacao: parseXmlValue(item, "Situacao"),
        horario: parseXmlValue(item, "Horario"),
        maxAlunos: numero(item, "MaxAlunos"),
        vagasOcupadas: numero(item, "VagasOcupadas"),
      },
    ];
  });
}

// Contrato que o aluno já tenha na turma, para o reprocessamento não criar uma
// segunda matrícula no Sponte.
export async function contratoExistente(
  creds: Credenciais,
  alunoId: number,
  turmaId: number,
): Promise<number | null> {
  const xml = await callSponte(
    "GetMatriculas",
    `AlunoID=${alunoId};TurmaID=${turmaId}`,
    creds.codigoCliente,
    creds.token,
  );
  if (checkFault(xml)) return null;
  for (const item of parseXmlList(xml, "wsMatricula")) {
    const contratoId = numero(item, "ContratoID");
    if (numero(item, "TurmaID") === turmaId && contratoId !== null && contratoId > 0) {
      return contratoId;
    }
  }
  return null;
}

export async function inserirMatricula(
  creds: Credenciais,
  params: Parameters<typeof montarParametrosInsertMatricula>[0],
): Promise<{ ok: boolean; contratoId: number | null; retorno: string }> {
  const xml = await callSponteMethod(
    "InsertMatricula",
    montarParametrosInsertMatricula(params),
    creds.codigoCliente,
    creds.token,
  );
  const falha = checkFault(xml);
  if (falha) return { ok: false, contratoId: null, retorno: falha };

  const retorno = parseXmlValue(xml, "RetornoOperacao");
  const contratoBruto = parseXmlValue(xml, "ContratoID");
  const contratoId = parseInt(contratoBruto, 10);
  return {
    ok: matriculaConfirmada(retorno, contratoBruto),
    contratoId: Number.isFinite(contratoId) && contratoId > 0 ? contratoId : null,
    retorno: retorno || "sem RetornoOperacao",
  };
}

export interface EntradaMatriculaTurma {
  unidade: string;
  alunoId: number;
  serie: string;
  turno: TurnoTurma | null;
  anoLetivo: number;
  dataMatricula: string;
  observacao: string;
}

export interface ResultadoMatriculaTurma {
  status: StatusMatriculaTurma;
  cursoId: number | null;
  turmaId: number | null;
  turmaNome: string | null;
  contratoId: number | null;
  // Preenchido quando a matrícula já existia no Sponte (reprocessamento).
  jaExistia: boolean;
  erro: string | null;
  retorno: string | null;
}

/**
 * Localiza a turma de série + turno + ano letivo e matricula o aluno nela.
 * `sem_turma` é pendência da secretaria (turma ainda não criada), `erro` é
 * falha técnica a reprocessar — em nenhum dos dois o cadastro do aluno é
 * desfeito.
 */
export async function matricularEmTurma(
  entrada: EntradaMatriculaTurma,
): Promise<ResultadoMatriculaTurma> {
  const base: ResultadoMatriculaTurma = {
    status: "erro",
    cursoId: null,
    turmaId: null,
    turmaNome: null,
    contratoId: null,
    jaExistia: false,
    erro: null,
    retorno: null,
  };

  const creds = resolverCredenciais(entrada.unidade);
  if (!creds) {
    return {
      ...base,
      erro: `Unidade "${entrada.unidade}" não tem integração Sponte configurada.`,
    };
  }

  if (entrada.turno === null) {
    return {
      ...base,
      status: "sem_turma",
      erro: textoPendenciaTurma({
        serie: entrada.serie,
        turno: null,
        anoLetivo: entrada.anoLetivo,
      }),
    };
  }

  try {
    const cursos = await buscarCursos(creds);
    const cursoId = cursoIdDaSerie(entrada.serie, cursos);
    if (cursoId === null) {
      return {
        ...base,
        status: "sem_turma",
        erro: `Nenhum curso ativo no Sponte corresponde à série "${entrada.serie}". Matricule o aluno manualmente.`,
      };
    }

    const turmas = await buscarTurmas(creds, { cursoId, anoLetivo: entrada.anoLetivo });
    const turma = escolherTurma(turmas, {
      cursoId,
      turno: entrada.turno,
      anoLetivo: entrada.anoLetivo,
    });
    if (!turma) {
      return {
        ...base,
        status: "sem_turma",
        cursoId,
        erro: textoPendenciaTurma({
          serie: entrada.serie,
          turno: entrada.turno,
          anoLetivo: entrada.anoLetivo,
        }),
      };
    }

    const jaMatriculado = await contratoExistente(creds, entrada.alunoId, turma.turmaId);
    if (jaMatriculado !== null) {
      return {
        ...base,
        status: "matriculado",
        cursoId,
        turmaId: turma.turmaId,
        turmaNome: turma.nome,
        contratoId: jaMatriculado,
        jaExistia: true,
      };
    }

    const envio = await inserirMatricula(creds, {
      alunoId: entrada.alunoId,
      cursoId,
      turmaId: turma.turmaId,
      anoLetivo: entrada.anoLetivo,
      dataMatricula: entrada.dataMatricula,
      observacao: entrada.observacao,
    });

    return {
      ...base,
      status: envio.ok ? "matriculado" : "erro",
      cursoId,
      turmaId: turma.turmaId,
      turmaNome: turma.nome,
      contratoId: envio.contratoId,
      retorno: envio.retorno,
      erro: envio.ok ? null : `O Sponte não confirmou a matrícula: ${envio.retorno}`,
    };
  } catch (e) {
    return { ...base, erro: e instanceof Error ? e.message : String(e) };
  }
}
