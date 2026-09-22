// Atalho da aba ZapSign: pessoas já cadastradas por unidade (Representante
// Legal em Dados dos Colégios e Testemunhas de Documentos) que podem ser
// adicionadas como signatário sem digitar do zero.

import type { ColegioRow } from "@/lib/colegios";
import type { TestemunhaDocumento } from "@/lib/testemunhas";

export interface SignatarioPreenchido {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
}

export interface SignatarioCadastrado extends SignatarioPreenchido {
  id: string;
  papel: string;
  /** Falso quando falta nome ou CPF: a opção aparece desabilitada. */
  completo: boolean;
}

type ColegioRepresentante = Pick<
  ColegioRow,
  | "unidade"
  | "representante_nome"
  | "representante_cpf"
  | "representante_email"
  | "representante_celular"
>;

const limpo = (v: string | null | undefined) => (v ?? "").trim();

export function signatariosCadastradosDaUnidade(
  unidade: string,
  colegios: readonly ColegioRepresentante[],
  testemunhas: readonly TestemunhaDocumento[],
): SignatarioCadastrado[] {
  const lista: SignatarioCadastrado[] = [];

  const colegio = colegios.find((c) => c.unidade === unidade);
  const repNome = limpo(colegio?.representante_nome);
  const repCpf = limpo(colegio?.representante_cpf);
  lista.push({
    id: "representante",
    papel: "Representante Legal",
    nome: repNome,
    cpf: repCpf,
    email: limpo(colegio?.representante_email),
    telefone: limpo(colegio?.representante_celular),
    completo: repNome !== "" && repCpf !== "",
  });

  testemunhas
    .filter((t) => t.ativa && t.unidade === unidade)
    .sort((a, b) => a.ordem - b.ordem)
    .forEach((t) => {
      const nome = limpo(t.nome);
      const cpf = limpo(t.cpf);
      lista.push({
        id: `testemunha-${t.ordem}`,
        papel: `Testemunha ${t.ordem}`,
        nome,
        cpf,
        email: limpo(t.email),
        telefone: limpo(t.celular),
        completo: nome !== "" && cpf !== "",
      });
    });

  return lista;
}

export function preencherSignatario(p: SignatarioCadastrado): SignatarioPreenchido {
  return { nome: p.nome, cpf: p.cpf, email: p.email, telefone: p.telefone };
}
