// Helpers de telefone (padrão brasileiro). A máscara visual usada em todo o
// sistema é "(XX) XXXXX-XXXX" (celular) / "(XX) XXXX-XXXX" (fixo). Os links
// wa.me sempre usam apenas dígitos com o DDI 55.

export function onlyDigits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

// Aplica a máscara visual brasileira. Aceita entrada parcial (para inputs ao
// vivo) e remove o DDI 55 de números longos para exibir o formato local.
export function formatPhoneBR(v: string | null | undefined): string {
  let d = onlyDigits(v);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

// Exibição segura: aplica a máscara quando há dígitos; caso contrário devolve o
// valor original (preserva placeholders como "-").
export function displayPhoneBR(v: string | null | undefined): string {
  return formatPhoneBR(v) || (v ?? "");
}

// Número pronto para a API do WhatsApp (wa.me): só dígitos, com DDI 55.
export function toWhatsAppNumber(v: string | null | undefined): string {
  const d = onlyDigits(v);
  if (!d) return "";
  return d.startsWith("55") ? d : `55${d}`;
}
