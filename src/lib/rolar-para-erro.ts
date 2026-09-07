// Leva a tela até o primeiro campo com erro depois que o React renderizou os
// destaques: inputs com aria-invalid ou mensagens inline marcadas com data-erro.
export function rolarParaPrimeiroErro(): void {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    const alvo = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-erro]');
    if (!alvo) return;
    alvo.scrollIntoView({ behavior: "smooth", block: "center" });
    if (alvo instanceof HTMLInputElement) alvo.focus({ preventScroll: true });
  });
}
