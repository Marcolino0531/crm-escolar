import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  DIARIO_FOTOS_BUCKET,
  caminhoDaFotoNoBucket,
  validarArquivoDeFoto,
} from "@/lib/diario-foto";
import type { DiarioStudent } from "@/lib/diario";

type Props = {
  student: DiarioStudent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function StudentPhotoDialog({ student, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) {
      setArquivo(null);
      setPreview(null);
      setSalvando(false);
    }
  }, [open]);

  useEffect(() => {
    if (!arquivo) return;
    const url = URL.createObjectURL(arquivo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const erro = validarArquivoDeFoto(file);
    if (erro) {
      toast.error(erro);
      return;
    }
    setArquivo(file);
  };

  const salvar = async () => {
    if (!arquivo) return;
    setSalvando(true);
    try {
      const path = caminhoDaFotoNoBucket(student.id, arquivo.name);
      const { error: upErr } = await supabase.storage
        .from(DIARIO_FOTOS_BUCKET)
        .upload(path, arquivo, { contentType: arquivo.type || "image/jpeg" });
      if (upErr) {
        toast.error(`Falha ao enviar a foto: ${upErr.message}`);
        return;
      }
      const { data: pub } = supabase.storage.from(DIARIO_FOTOS_BUCKET).getPublicUrl(path);
      const { error: updErr } = await supabase
        .from("diario_students" as never)
        .update({ photo: pub.publicUrl } as never)
        .eq("id", student.id);
      if (updErr) {
        await supabase.storage.from(DIARIO_FOTOS_BUCKET).remove([path]);
        toast.error(`Falha ao salvar a foto: ${updErr.message}`);
        return;
      }
      // A foto anterior só é removida depois que o cadastro já aponta para a
      // nova, para nunca deixar o aluno sem imagem se a limpeza falhar.
      const anterior = caminhoAnterior(student.photo);
      if (anterior && anterior !== path) {
        await supabase.storage.from(DIARIO_FOTOS_BUCKET).remove([anterior]);
      }
      await qc.invalidateQueries({ queryKey: ["diario_students"] });
      await qc.invalidateQueries({ queryKey: ["diario_students_manage"] });
      toast.success("Foto atualizada.");
      onOpenChange(false);
    } finally {
      setSalvando(false);
    }
  };

  const atual = preview ?? student.photo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar foto</DialogTitle>
          <DialogDescription>
            {student.name} · JPG ou PNG, até 5 MB. A foto substitui a atual no Diário.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {atual ? (
            <img
              src={atual}
              alt={student.name}
              className="h-32 w-32 rounded-full object-cover ring-2 ring-primary/20"
            />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-full bg-secondary ring-2 ring-primary/20">
              <UserCircle2 className="h-14 w-14 text-muted-foreground" />
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={escolher}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={salvando}>
            <Upload className="mr-2 h-4 w-4" />
            {arquivo ? "Escolher outra imagem" : "Escolher imagem"}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={!arquivo || salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar foto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Extrai o caminho no bucket a partir da URL pública salva no cadastro. Fotos
// hospedadas fora do bucket (URLs antigas do Lovable) retornam null.
function caminhoAnterior(url: string | null): string | null {
  if (!url) return null;
  const marcador = `/${DIARIO_FOTOS_BUCKET}/`;
  const i = url.indexOf(marcador);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + marcador.length).split("?")[0]);
}
