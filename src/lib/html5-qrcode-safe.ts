import { Html5Qrcode, Html5QrcodeScannerState, type Html5QrcodeFullConfig } from "html5-qrcode";

// A html5-qrcode lança strings (não Error) de forma síncrona — ex.:
// "HTML Element with id=... not found" no construtor e "Cannot stop, scanner is
// not running or paused." no stop. Estes helpers mantêm essas falhas dentro da
// janela do leitor, sem chegar ao errorComponent da rota.

export const MAX_FRAMES_AGUARDANDO_REGIAO = 20;

export function mensagemDeErroLeitor(
  e: unknown,
  padrao = "Não foi possível acessar a câmera.",
): string {
  if (e instanceof Error) return e.message || padrao;
  if (typeof e === "string") return e || padrao;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string" && e.message) {
    return e.message;
  }
  try {
    const s = String(e);
    return s && s !== "[object Object]" ? s : padrao;
  } catch {
    return padrao;
  }
}

export function criarLeitorSeguro(
  regionId: string,
  config: Html5QrcodeFullConfig,
): { ok: true; leitor: Html5Qrcode } | { ok: false; erro: string } {
  if (typeof document === "undefined" || !document.getElementById(regionId)) {
    return { ok: false, erro: `Área da câmera (${regionId}) não encontrada.` };
  }
  try {
    return { ok: true, leitor: new Html5Qrcode(regionId, config) };
  } catch (e) {
    return { ok: false, erro: mensagemDeErroLeitor(e) };
  }
}

export function leitorEstaRodando(leitor: Html5Qrcode): boolean {
  try {
    const st = leitor.getState();
    return st === Html5QrcodeScannerState.SCANNING || st === Html5QrcodeScannerState.PAUSED;
  } catch {
    return false;
  }
}

// Para e limpa o leitor sem nunca lançar: stop só quando estiver rodando; falhas
// de stop/clear viram console.warn.
export function encerrarLeitorSeguro(leitor: Html5Qrcode, iniciado: boolean): void {
  const limpar = () => {
    try {
      leitor.clear();
    } catch (e) {
      console.warn("[html5-qrcode] clear falhou:", mensagemDeErroLeitor(e));
    }
  };
  if (!iniciado || !leitorEstaRodando(leitor)) {
    limpar();
    return;
  }
  try {
    leitor
      .stop()
      .catch((e: unknown) => console.warn("[html5-qrcode] stop falhou:", mensagemDeErroLeitor(e)))
      .finally(limpar);
  } catch (e) {
    console.warn("[html5-qrcode] stop falhou:", mensagemDeErroLeitor(e));
    limpar();
  }
}
