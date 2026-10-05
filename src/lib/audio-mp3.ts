// Conversão da gravação do microfone para MP3 no próprio navegador. O
// MediaRecorder grava em webm/opus ou MP4 fragmentado, formatos que a Meta não
// reconhece como áudio. O MP3 mono a 64 kbps é aceito sempre.

export const MP3_KBPS = 64;
const AMOSTRAS_POR_BLOCO = 1152;

type CodificadorMp3 = typeof import("@breezystack/lamejs");

// Média dos canais (mono).
export function misturarParaMono(canais: readonly Float32Array[]): Float32Array {
  if (canais.length === 1) return canais[0];
  const n = Math.min(...canais.map((c) => c.length));
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let soma = 0;
    for (const c of canais) soma += c[i];
    mono[i] = soma / canais.length;
  }
  return mono;
}

// Float de -1 a 1 para PCM 16 bits.
export function paraPcm16(amostras: Float32Array): Int16Array {
  const pcm = new Int16Array(amostras.length);
  for (let i = 0; i < amostras.length; i++) {
    const s = Math.max(-1, Math.min(1, amostras[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

// O lamejs devolve Int8Array apesar do tipo declarado; normaliza para bytes.
function bytes(parte: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number }) {
  return new Uint8Array(parte.buffer, parte.byteOffset, parte.length);
}

// PCM 16 bits mono para MP3 mono, taxa constante de 64 kbps.
export function pcmParaMp3(
  lame: CodificadorMp3,
  pcm: Int16Array,
  taxaAmostragem: number,
): Uint8Array[] {
  const encoder = new lame.Mp3Encoder(1, taxaAmostragem, MP3_KBPS);
  const partes: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += AMOSTRAS_POR_BLOCO) {
    const parte = encoder.encodeBuffer(pcm.subarray(i, i + AMOSTRAS_POR_BLOCO));
    if (parte.length > 0) partes.push(bytes(parte));
  }
  const fim = encoder.flush();
  if (fim.length > 0) partes.push(bytes(fim));
  return partes;
}

let codificador: Promise<CodificadorMp3> | null = null;

// Import dinâmico, só na primeira gravação (não pesa o carregamento da tela).
export function carregarCodificadorMp3(): Promise<CodificadorMp3> {
  codificador ??= import("@breezystack/lamejs").catch((e) => {
    codificador = null;
    throw e;
  });
  return codificador;
}

// O navegador sempre decodifica o formato que ele mesmo gravou.
async function decodificar(dados: ArrayBuffer): Promise<AudioBuffer> {
  const Contexto =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Contexto) throw new Error("AudioContext indisponível");
  const ctx = new Contexto();
  try {
    return await ctx.decodeAudioData(dados);
  } finally {
    void ctx.close();
  }
}

export async function gravacaoParaMp3(gravacao: Blob): Promise<File> {
  const [lame, dados] = await Promise.all([carregarCodificadorMp3(), gravacao.arrayBuffer()]);
  const audio = await decodificar(dados);
  const canais = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const pcm = paraPcm16(misturarParaMono(canais));
  const partes = pcmParaMp3(lame, pcm, audio.sampleRate);
  return new File(partes as BlobPart[], "audio.mp3", { type: "audio/mpeg" });
}
