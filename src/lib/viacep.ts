// Consulta pública do ViaCEP (sem chave). Usada pelos formulários públicos de
// matrícula e rematrícula: falha de rede ou CEP inexistente devolve vazio, e os
// campos seguem editáveis à mão.

export interface EnderecoViaCep {
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

interface ViaCepResposta {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

export async function buscarEnderecoPorCep(cep: string): Promise<EnderecoViaCep | null> {
  const digitos = cep.replace(/\D/g, "");
  if (digitos.length !== 8) return null;
  try {
    const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as ViaCepResposta;
    if (dados.erro) return null;
    return {
      logradouro: dados.logradouro ?? "",
      bairro: dados.bairro ?? "",
      cidade: dados.localidade ?? "",
      uf: dados.uf ?? "",
    };
  } catch {
    return null;
  }
}

// Completa a UF de cadastros que já têm CEP mas vieram sem Estado (o Sponte não
// devolve a UF do aluno nem do responsável). Quem não tem CEP, ou cujo CEP o
// ViaCEP não conhece, fica como está. As consultas rodam em paralelo.
export async function completarUfPeloCep<T extends { cep: string; uf: string }>(
  itens: T[],
  buscar: (cep: string) => Promise<EnderecoViaCep | null> = buscarEnderecoPorCep,
): Promise<T[]> {
  return Promise.all(
    itens.map(async (item) => {
      if (item.uf.trim() || item.cep.replace(/\D/g, "").length !== 8) return item;
      const achado = await buscar(item.cep);
      return achado?.uf ? { ...item, uf: achado.uf.toUpperCase() } : item;
    }),
  );
}
