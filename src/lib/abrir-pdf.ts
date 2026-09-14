// Abre um PDF (base64) numa aba nova; se o navegador bloquear o popup, baixa.
export function abrirPdfBase64(base64: string, nomeArquivo: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const aba = window.open(url, "_blank", "noopener");
  if (!aba) {
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
