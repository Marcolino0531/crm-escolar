// Consulta pública do ViaCEP (sem chave). Usada pelos formulários públicos de
// matrícula e rematrícula: falha de rede ou CEP inexistente devolve vazio, e os
// campos seguem editáveis à mão.

export interface EnderecoViaCep {
  logradouro: string;
  bairro: string;
  cidade: string;
}

interface ViaCepResposta {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
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
    };
  } catch {
    return null;
  }
}
