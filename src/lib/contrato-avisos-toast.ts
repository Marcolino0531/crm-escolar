import { toast } from "sonner";

/** Avisos dos EXTRAS (Sponte × Diário) — o contrato saiu; quem gera precisa saber. */
export function avisarExtrasContrato(avisos: readonly string[] | undefined) {
  if (!avisos?.length) return;
  toast.warning("EXTRAS: dados do Diário incompletos ou divergentes", {
    description: avisos.join("\n"),
    duration: 20000,
  });
}
