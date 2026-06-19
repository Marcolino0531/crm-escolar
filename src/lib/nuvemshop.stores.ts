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
