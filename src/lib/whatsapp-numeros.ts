// Roteamento de conversas do WhatsApp por NÚMERO da escola (lógica pura).
//
// A escola opera dois números na Cloud API: um atende CEC e CEC Baby, outro
// atende Núcleo Belvedere e Núcleo Vale do Sereno. Cada evento do webhook traz
// em `value.metadata.phone_number_id` o número que RECEBEU a mensagem — é esse
// identificador, e não o telefone do responsável, que define a qual par de
// unidades a conversa pertence e por qual número a resposta precisa sair. O
// webhook grava na conversa o `phone_number_id` e o grupo correspondente.
//
// Um número cobre duas unidades, então o filtro da tela é por GRUPO: escolher
// CEC ou CEC Baby mostra as conversas do número do CEC; escolher Belvedere ou
// Vale do Sereno mostra as do outro número.

export type NumeroGrupo = "cec" | "belvedere";

export const UNIDADES_POR_GRUPO: Record<NumeroGrupo, string[]> = {
  cec: ["CEC", "CEC Baby"],
  belvedere: ["Núcleo Belvedere", "Núcleo Vale do Sereno"],
};

// Grupo antes de existir o segundo número: toda conversa histórica entrou pelo
// número do CEC, então uma conversa sem grupo nem unidade conhecida é "cec".
export const GRUPO_LEGADO: NumeroGrupo = "cec";

// Número configurado da Cloud API (o token fica só no servidor).
export interface NumeroWhatsApp {
  grupo: NumeroGrupo;
  phoneNumberId: string;
}

// Campos da conversa usados no roteamento.
export interface ConversaRoteavel {
  phone_number_id?: string | null;
  numero_grupo?: string | null;
  unidade?: string | null;
}

export function ehNumeroGrupo(valor: string | null | undefined): valor is NumeroGrupo {
  return valor === "cec" || valor === "belvedere";
}

export function grupoDaUnidade(unidade: string | null | undefined): NumeroGrupo | null {
  const nome = (unidade ?? "").trim();
  if (!nome) return null;
  for (const grupo of Object.keys(UNIDADES_POR_GRUPO) as NumeroGrupo[]) {
    if (UNIDADES_POR_GRUPO[grupo].includes(nome)) return grupo;
  }
  return null;
}

export function unidadesDoGrupo(grupo: NumeroGrupo): string[] {
  return UNIDADES_POR_GRUPO[grupo];
}

// Grupo do número que recebeu/deve enviar a mensagem.
export function grupoDoPhoneNumberId(
  phoneNumberId: string | null | undefined,
  numeros: NumeroWhatsApp[],
): NumeroGrupo | null {
  const id = (phoneNumberId ?? "").trim();
  if (!id) return null;
  return numeros.find((n) => n.phoneNumberId === id)?.grupo ?? null;
}

// Grupo a que a conversa pertence: o número gravado manda; sem ele, cai na
// unidade vinculada e, por fim, no número histórico.
export function grupoDaConversa(conversa: ConversaRoteavel): NumeroGrupo {
  if (ehNumeroGrupo(conversa.numero_grupo)) return conversa.numero_grupo;
  return grupoDaUnidade(conversa.unidade) ?? GRUPO_LEGADO;
}

// Número por onde a resposta deve sair. O `phone_number_id` da conversa é a
// referência exata; se ele saiu da configuração, usa o número do grupo.
export function numeroDeEnvio(
  conversa: ConversaRoteavel,
  numeros: NumeroWhatsApp[],
): NumeroWhatsApp | null {
  const exato = numeros.find((n) => n.phoneNumberId === (conversa.phone_number_id ?? "").trim());
  if (exato) return exato;
  const grupo = grupoDaConversa(conversa);
  return numeros.find((n) => n.grupo === grupo) ?? numeros[0] ?? null;
}

// Escolhe, entre as conversas do mesmo telefone, a que pertence ao número que
// recebeu o evento. O mesmo responsável pode falar com os dois números da escola
// e cada lado tem a sua conversa: casar só pelo telefone misturaria as duas.
// Conversa antiga (sem `phone_number_id`) é adotada pelo número do grupo dela,
// para o histórico não se partir quando o segundo número entra em operação.
export function escolherConversaDoNumero<T extends ConversaRoteavel>(
  candidatas: T[],
  phoneNumberId: string | null | undefined,
  numeros: NumeroWhatsApp[],
): T | null {
  const id = (phoneNumberId ?? "").trim();
  if (!id) return candidatas[0] ?? null;

  const exata = candidatas.find((c) => (c.phone_number_id ?? "").trim() === id);
  if (exata) return exata;

  const grupo = grupoDoPhoneNumberId(id, numeros);
  const legada = candidatas.find(
    (c) => !(c.phone_number_id ?? "").trim() && (grupo === null || grupoDaConversa(c) === grupo),
  );
  return legada ?? null;
}

// Filtro da lista de conversas pelo seletor de unidade do topo. `unidade` nula
// (Todas as Unidades) ou desconhecida não filtra nada.
export function conversaVisivelNaUnidade(
  conversa: ConversaRoteavel,
  unidade: string | null,
): boolean {
  const grupoSelecionado = grupoDaUnidade(unidade);
  if (!grupoSelecionado) return true;
  return grupoDaConversa(conversa) === grupoSelecionado;
}
