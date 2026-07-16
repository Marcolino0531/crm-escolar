// Preposições/partículas mantidas em minúsculo no meio do nome (exceto quando
// são a primeira palavra). Espelha a função public.title_case() do banco.
const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "du"]);

// Converte um texto (ex.: "SERGIO GABRIEL") para Title Case ("Sergio Gabriel"),
// preservando as preposições em minúsculo. Ex.: "MARIA DA SILVA" → "Maria da Silva".
export function toTitleCase(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      const low = word.toLowerCase();
      if (i > 0 && PARTICULAS.has(low)) return low;
      return low.charAt(0).toUpperCase() + low.slice(1);
    })
    .join(" ");
}
