import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/app-context";
import { formatarCpf } from "@/lib/matricula-form";
import { formatarDataBR } from "@/lib/recibos";

export type TestemunhaRow = {
  id: string;
  ordem: number;
  nome: string;
  cpf: string;
  email: string;
  celular: string;
  ativa: boolean;
  updated_at: string;
  updated_by_nome: string;
};

const CAMPOS: { key: "nome" | "cpf" | "email" | "celular"; label: string; placeholder?: string }[] =
  [
    { key: "nome", label: "Nome completo" },
    { key: "cpf", label: "CPF", placeholder: "000.000.000-00" },
    { key: "email", label: "E-mail (assinatura na ZapSign)", placeholder: "nome@email.com" },
    { key: "celular", label: "Celular (assinatura na ZapSign)", placeholder: "(31) 99999-9999" },
  ];

// Cadastro GLOBAL (vale para as três escolas) das duas testemunhas que assinam
// todo Contrato de Matrícula na ZapSign. São duas linhas fixas, não uma lista.
export function TestemunhasContrato({ podeEditar }: { podeEditar: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contrato_testemunhas"],
    queryFn: async (): Promise<TestemunhaRow[]> => {
      const { data, error } = await supabase
        .from("contrato_testemunhas" as never)
        .select("id, ordem, nome, cpf, email, celular, ativa, updated_at, updated_by_nome")
        .eq("ativa", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TestemunhaRow[];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Testemunhas do Contrato de Matrícula</h3>
        <p className="text-xs text-muted-foreground">
          As mesmas duas pessoas assinam digitalmente todos os contratos das três escolas. Sem
          e-mail e celular preenchidos, o contrato não é gerado.
        </p>
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-red-700">
          Nenhuma testemunha ativa cadastrada (a migration de testemunhas ainda não foi aplicada).
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(data ?? []).map((t) => (
            <FormularioTestemunha key={t.id} testemunha={t} podeEditar={podeEditar} />
          ))}
        </div>
      )}
    </div>
  );
}

function FormularioTestemunha({
  testemunha,
  podeEditar,
}: {
  testemunha: TestemunhaRow;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [form, setForm] = useState(testemunha);
  useEffect(() => setForm(testemunha), [testemunha]);

  const salvar = useMutation({
    mutationFn: async () => {
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const { error } = await supabase
        .from("contrato_testemunhas" as never)
        .update({
          nome: form.nome.trim(),
          cpf: form.cpf.trim(),
          email: form.email.trim(),
          celular: form.celular.trim(),
          updated_at: new Date().toISOString(),
          updated_by: session?.user?.id ?? null,
          updated_by_nome: meta?.full_name || session?.user?.email || "",
        } as never)
        .eq("id", testemunha.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Testemunha ${testemunha.ordem} salva.`);
      void qc.invalidateQueries({ queryKey: ["contrato_testemunhas"] });
    },
    onError: (e: Error) => toast.error(`Erro ao salvar: ${e.message}`),
  });

  return (
    <div className="space-y-3 rounded-md border p-4">
      <p className="text-sm font-medium">TESTEMUNHA {testemunha.ordem}</p>
      {CAMPOS.map((campo) => (
        <div key={campo.key} className="flex flex-col gap-1">
          <Label htmlFor={`test-${testemunha.id}-${campo.key}`}>{campo.label}</Label>
          <Input
            id={`test-${testemunha.id}-${campo.key}`}
            value={form[campo.key]}
            placeholder={campo.placeholder}
            disabled={!podeEditar}
            onChange={(e) => {
              const valor = campo.key === "cpf" ? formatarCpf(e.target.value) : e.target.value;
              setForm((prev) => ({ ...prev, [campo.key]: valor }));
            }}
          />
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {testemunha.updated_by_nome
            ? `Atualizado em ${formatarDataBR(testemunha.updated_at.slice(0, 10))} por ${testemunha.updated_by_nome}`
            : ""}
        </p>
        {podeEditar && (
          <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Salvar
          </Button>
        )}
      </div>
    </div>
  );
}
