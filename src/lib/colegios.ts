import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { carregarLogo, type LogoRecibo } from "@/lib/recibo-pdf";
import type { ColegioRecibo } from "@/lib/recibos";

export const UNIDADES = ["CEC", "CEC Baby", "Núcleo Vale do Sereno", "Núcleo Belvedere"];
export const DOCUMENTOS_BUCKET = "documentos";

export type ColegioRow = {
  unidade: string;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  inscricao_municipal: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  telefone: string;
  email: string;
  site: string;
  assinante_nome: string;
  assinante_cargo: string;
  representante_nome: string;
  representante_oab: string;
  representante_cpf: string;
  representante_email: string;
  representante_celular: string;
  observacao: string;
  logo_path: string | null;
  updated_at: string;
  updated_by_nome: string;
};

export const COLEGIO_CAMPOS: {
  key: keyof ColegioRow;
  label: string;
  placeholder?: string;
  mascara?: "cpf" | "celular";
}[] = [
  { key: "razao_social", label: "Razão social" },
  { key: "nome_fantasia", label: "Nome fantasia" },
  { key: "cnpj", label: "CNPJ", placeholder: "00.000.000/0000-00" },
  { key: "inscricao_municipal", label: "Inscrição municipal" },
  { key: "endereco", label: "Endereço (rua/av.)" },
  { key: "numero", label: "Número" },
  { key: "complemento", label: "Complemento" },
  { key: "bairro", label: "Bairro" },
  { key: "cidade", label: "Cidade" },
  { key: "uf", label: "UF", placeholder: "MG" },
  { key: "cep", label: "CEP" },
  { key: "telefone", label: "Telefone" },
  { key: "email", label: "E-mail" },
  { key: "site", label: "Site" },
  { key: "assinante_nome", label: "Assina o recibo (nome)" },
  { key: "assinante_cargo", label: "Cargo de quem assina" },
  { key: "representante_nome", label: "Representante Legal" },
  {
    key: "representante_cpf",
    label: "CPF do representante legal",
    placeholder: "000.000.000-00",
    mascara: "cpf",
  },
  {
    key: "representante_email",
    label: "E-mail pessoal do representante legal (assinatura do contrato)",
    placeholder: "nome@email.com",
  },
  {
    key: "representante_celular",
    label: "Celular pessoal do representante legal (assinatura do contrato)",
    placeholder: "(31) 99999-9999",
    mascara: "celular",
  },
];

export function colegioVazio(unidade: string): ColegioRow {
  return {
    unidade,
    razao_social: "",
    nome_fantasia: "",
    cnpj: "",
    inscricao_municipal: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: "",
    telefone: "",
    email: "",
    site: "",
    assinante_nome: "",
    assinante_cargo: "",
    representante_nome: "",
    representante_oab: "",
    representante_cpf: "",
    representante_email: "",
    representante_celular: "",
    observacao: "",
    logo_path: null,
    updated_at: "",
    updated_by_nome: "",
  };
}

export function paraColegioRecibo(row: ColegioRow): ColegioRecibo {
  return {
    unidade: row.unidade,
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia,
    cnpj: row.cnpj,
    inscricaoMunicipal: row.inscricao_municipal,
    endereco: row.endereco,
    numero: row.numero,
    complemento: row.complemento,
    bairro: row.bairro,
    cidade: row.cidade,
    uf: row.uf,
    cep: row.cep,
    telefone: row.telefone,
    email: row.email,
    site: row.site,
    assinanteNome: row.assinante_nome,
    assinanteCargo: row.assinante_cargo,
    representanteNome: row.representante_nome ?? "",
    representanteOab: row.representante_oab ?? "",
    observacao: row.observacao,
  };
}

export async function carregarLogoDoColegio(logoPath: string | null): Promise<LogoRecibo | null> {
  if (!logoPath) return null;
  const { data } = await supabase.storage.from(DOCUMENTOS_BUCKET).createSignedUrl(logoPath, 120);
  if (!data?.signedUrl) return null;
  return await carregarLogo(data.signedUrl);
}

export function useColegios() {
  return useQuery({
    queryKey: ["documentos_colegios"],
    queryFn: async (): Promise<ColegioRow[]> => {
      const { data, error } = await supabase.from("documentos_colegios" as never).select("*");
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as ColegioRow[];
      return UNIDADES.map((u) => rows.find((r) => r.unidade === u) ?? colegioVazio(u));
    },
  });
}
