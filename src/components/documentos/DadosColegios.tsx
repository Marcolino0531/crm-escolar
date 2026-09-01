import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/app-context";
import { COLEGIO_CAMPOS, DOCUMENTOS_BUCKET, useColegios, type ColegioRow } from "@/lib/colegios";
import { SelecioneUnidade, useUnidadeAtiva } from "@/components/SelecioneUnidade";
import { formatarDataBR } from "@/lib/recibos";

// Cadastro das unidades (dados usados nos documentos oficiais). Vive em
// Configurações → Dados dos Colégios; o módulo Documentos apenas consome.
export function DadosColegios({ podeEditar }: { podeEditar: boolean }) {
  const { data: colegios = [], isLoading } = useColegios();
  // Unidade do seletor global do topo: a aba edita sempre o colégio do topo.
  const unidade = useUnidadeAtiva();

  if (!unidade) return <SelecioneUnidade acao="A edição dos dados do colégio" />;

  const atual = colegios.find((c) => c.unidade === unidade);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <Label className="text-[11px] text-muted-foreground">Colégio</Label>
        <div className="flex h-9 w-64 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
          {unidade}
        </div>
      </div>

      {isLoading || !atual ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <FormularioColegio key={atual.unidade} colegio={atual} podeEditar={podeEditar} />
      )}
    </div>
  );
}

function FormularioColegio({ colegio, podeEditar }: { colegio: ColegioRow; podeEditar: boolean }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [form, setForm] = useState<ColegioRow>(colegio);
  const [enviandoLogo, setEnviandoLogo] = useState(false);

  const { data: logoUrl } = useQuery({
    queryKey: ["documentos_logo", colegio.unidade, colegio.logo_path],
    enabled: !!colegio.logo_path,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase.storage
        .from(DOCUMENTOS_BUCKET)
        .createSignedUrl(colegio.logo_path as string, 300);
      return data?.signedUrl ?? null;
    },
  });

  const salvar = useMutation({
    mutationFn: async (extra?: Partial<ColegioRow>) => {
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const {
        unidade,
        updated_at: _updatedAt,
        updated_by_nome: _updatedBy,
        ...campos
      } = {
        ...form,
        ...extra,
      };
      const { error } = await supabase.from("documentos_colegios" as never).upsert(
        {
          unidade,
          ...campos,
          updated_by: session?.user?.id ?? null,
          updated_by_nome: meta?.full_name || session?.user?.email || "",
        } as never,
        { onConflict: "unidade" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Dados do colégio salvos.");
      qc.invalidateQueries({ queryKey: ["documentos_colegios"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar."),
  });

  const enviarLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp|svg\+xml)$/.test(file.type)) {
      toast.error("Envie a logo em PNG, JPG, WEBP ou SVG.");
      return;
    }
    setEnviandoLogo(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `logos/${colegio.unidade.replace(/[^\w]+/g, "-")}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(DOCUMENTOS_BUCKET)
        .upload(path, file, { contentType: file.type });
      if (upErr) {
        toast.error(`Falha ao enviar a logo: ${upErr.message}`);
        return;
      }
      setForm((prev) => ({ ...prev, logo_path: path }));
      await salvar.mutateAsync({ logo_path: path });
      if (colegio.logo_path && colegio.logo_path !== path) {
        await supabase.storage.from(DOCUMENTOS_BUCKET).remove([colegio.logo_path]);
      }
    } finally {
      setEnviandoLogo(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30">
          {logoUrl ? (
            <img src={logoUrl} alt={`Logo ${colegio.unidade}`} className="max-h-24 max-w-40" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
              <ImageIcon className="h-5 w-5" /> Sem logo
            </span>
          )}
        </div>
        {podeEditar && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            {enviandoLogo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
            {colegio.logo_path ? "Trocar logo" : "Enviar logo"}
            <input type="file" accept="image/*" className="hidden" onChange={enviarLogo} />
          </label>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {COLEGIO_CAMPOS.map((campo) => (
          <div key={campo.key} className="flex flex-col gap-1">
            <Label htmlFor={`col-${campo.key}`} className="text-[11px] text-muted-foreground">
              {campo.label}
            </Label>
            <Input
              id={`col-${campo.key}`}
              value={String(form[campo.key] ?? "")}
              placeholder={campo.placeholder}
              disabled={!podeEditar}
              className="h-9"
              onChange={(e) => setForm((prev) => ({ ...prev, [campo.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="col-observacao" className="text-[11px] text-muted-foreground">
          Observação impressa no pé do recibo
        </Label>
        <Textarea
          id="col-observacao"
          value={form.observacao}
          disabled={!podeEditar}
          rows={2}
          onChange={(e) => setForm((prev) => ({ ...prev, observacao: e.target.value }))}
        />
      </div>

      {podeEditar && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {colegio.updated_at
              ? `Atualizado em ${formatarDataBR(colegio.updated_at.slice(0, 10))}${
                  colegio.updated_by_nome ? ` por ${colegio.updated_by_nome}` : ""
                }`
              : "Ainda não cadastrado."}
          </span>
          <Button
            className="gap-1"
            disabled={salvar.isPending}
            onClick={() => salvar.mutate(undefined)}
          >
            {salvar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar dados do colégio
          </Button>
        </div>
      )}
    </div>
  );
}
