// Foto do aluno do Diário: arquivo próprio do School Hub, guardado no bucket
// público `diario-fotos` e referenciado por URL em diario_students.photo. O
// Sponte não é fonte nem destino da imagem (a sincronização preserva o campo).

export const DIARIO_FOTOS_BUCKET = "diario-fotos";

export const TAMANHO_MAX_FOTO = 5 * 1024 * 1024;

const TIPOS_ACEITOS = ["image/jpeg", "image/png"];

export function validarArquivoDeFoto(file: File): string | null {
  const nome = file.name.toLowerCase();
  const tipoOk = TIPOS_ACEITOS.includes(file.type) || /\.(jpe?g|png)$/.test(nome) ? true : false;
  if (!tipoOk) return "Envie uma imagem JPG ou PNG.";
  if (file.size > TAMANHO_MAX_FOTO) return "A imagem deve ter no máximo 5 MB.";
  return null;
}

export function caminhoDaFotoNoBucket(studentId: string, fileName: string): string {
  const ext = /\.(png)$/i.test(fileName) ? "png" : "jpg";
  return `alunos/${studentId}-${Date.now()}.${ext}`;
}
