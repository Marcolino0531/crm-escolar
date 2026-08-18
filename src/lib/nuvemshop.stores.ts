// Configuração das lojas Nuvemshop (multiloja por unidade).
//
// Cada loja atende um conjunto de unidades (schools). O catálogo é gravado com
// a `store_key` correspondente; o frontend filtra o estoque pela unidade
// selecionada no header, mapeando-a de volta para a loja via `units`.
//
// Variáveis de ambiente (painel da Vercel), por loja:
//   NUVEMSHOP_BELVEDERE_STORE_ID / NUVEMSHOP_BELVEDERE_TOKEN
//   NUVEMSHOP_CEC_STORE_ID       / NUVEMSHOP_CEC_TOKEN
// Compatibilidade: NUVEMSHOP_STORE_ID / NUVEMSHOP_ACCESS_TOKEN (legado) são
// usados como fallback da loja 'belvedere'.

export type StoreKey = "belvedere" | "cec";

export type StoreDef = {
  key: StoreKey;
  label: string;
  // Nomes exatos das unidades (schools) atendidas por esta loja.
  units: string[];
};

export const STORES: StoreDef[] = [
  {
    key: "belvedere",
    label: "Belvedere / Vale do Sereno",
    units: ["Núcleo Belvedere", "Núcleo Vale do Sereno"],
  },
  {
    key: "cec",
    label: "CEC / CEC Baby",
    units: ["CEC", "CEC Baby"],
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// Resolve a store_key a partir do nome de uma unidade (school). Retorna null
// quando a unidade não pertence a nenhuma loja configurada.
export function storeKeyForUnitName(unitName: string | null | undefined): StoreKey | null {
  if (!unitName) return null;
  const target = normalize(unitName);
  for (const store of STORES) {
    if (store.units.some((u) => normalize(u) === target)) return store.key;
  }
  return null;
}

// Belvedere e Vale do Sereno partilham a mesma loja Nuvemshop (store_key
// "belvedere"), então a origem só pode ser distinguida pelo nome da peça: os
// itens do Vale do Sereno vêm prefixados com "VALE DO SERENO - ...". Como esses
// uniformes estão sendo descontinuados, seus alertas de estoque baixo são
// intencionalmente ignorados.
export function isValeDoSerenoProductName(name: string | null | undefined): boolean {
  if (!name) return false;
  return normalize(name).includes("vale do sereno");
}

// Peça de algodão ("Regata (Algodão)"): pedida sob encomenda para aluno com
// alergia a outros tecidos, nunca reposta em lote junto à fábrica.
export function isPecaAlgodao(name: string | null | undefined): boolean {
  if (!name) return false;
  return normalize(name).includes("(algodao)");
}

// Uniforme NOVO do CEC/CEC Baby: identificado por "/ Azul" no nome
// ("Bermuda Tactel / Azul"). Aceita com e sem espaço em volta da barra.
export function isUniformeNovoCEC(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\/\s*azul\b/.test(normalize(name));
}

// Por que a peça está fora da reposição planejada — e portanto fora do alerta de
// estoque baixo, mesmo zerada. `null` = a peça entra no alerta normalmente.
export type MotivoForaDaReposicao = "algodao" | "uniforme_antigo_cec" | "vale_do_sereno";

export function motivoForaDaReposicao(
  storeKey: StoreKey,
  produto: string | null | undefined,
): MotivoForaDaReposicao | null {
  // Vale antes de tudo: algodão é exceção em qualquer unidade.
  if (isPecaAlgodao(produto)) return "algodao";
  // CEC/CEC Baby em troca de uniforme: só o modelo novo ("/ Azul") é reposto.
  if (storeKey === "cec" && !isUniformeNovoCEC(produto)) return "uniforme_antigo_cec";
  // Vale do Sereno partilha a loja "belvedere" e é distinguido pelo nome.
  if (isValeDoSerenoProductName(produto)) return "vale_do_sereno";
  return null;
}

// Saldo abaixo do mínimo — estritamente menor: com o mínimo em 5, a peça com 5
// unidades ainda está no nível desejado e não é reposta.
export function abaixoDoEstoqueMinimo(stock: number, minStock: number): boolean {
  return stock < minStock;
}

// Regra única do alerta de estoque baixo, usada pelo sininho e pela tabela de
// Uniformes: saldo abaixo do mínimo E peça que ainda é reposta.
export function notificaEstoqueBaixo(variacao: {
  storeKey: StoreKey;
  produto: string | null | undefined;
  stock: number;
  minStock: number;
}): boolean {
  if (!abaixoDoEstoqueMinimo(variacao.stock, variacao.minStock)) return false;
  return motivoForaDaReposicao(variacao.storeKey, variacao.produto) === null;
}
