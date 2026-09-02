// Escolha do parcelamento do material pedagógico no formulário público de
// matrícula (1x a 8x), com o mesmo desenho da Rematrícula.
//
// O valor anual e as opções vêm do servidor (unidade + série calculada pela
// data de corte): a tela só mostra e guarda a escolha, que é enviada junto do
// formulário — não há botão de confirmação separado.

import { Loader2 } from "lucide-react";
import type { ErrosForm, MaterialForm } from "@/lib/matricula-form";
import type { MaterialMatriculaPublica } from "@/lib/matricula-publica.functions";
import { formatarBRL } from "@/lib/rematricula";

interface Props {
  material: MaterialForm;
  dados: MaterialMatriculaPublica | undefined;
  carregando: boolean;
  erros: ErrosForm;
  onChange: (material: MaterialForm) => void;
}

export function MaterialPedagogico({ material, dados, carregando, erros, onChange }: Props) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Material pedagógico</h2>

      {carregando && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Consultando o valor do material…
        </p>
      )}

      {!carregando && !dados?.configurado && (
        <p className="text-sm text-muted-foreground">
          O valor do material da série do(a) aluno(a) ainda não está disponível. A secretaria vai
          combinar o pagamento com você.
        </p>
      )}

      {!carregando && dados?.configurado && (
        <>
          <p className="text-sm text-muted-foreground">
            Série {dados.serie} — valor anual de {formatarBRL(dados.valorAnual)}. Escolha em quantas
            parcelas quer pagar.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {dados.opcoes.map((op) => (
              <button
                key={op.parcelas}
                type="button"
                onClick={() => onChange({ ...material, parcelas: op.parcelas })}
                className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                  material.parcelas === op.parcelas
                    ? "border-primary bg-primary/10"
                    : "hover:bg-muted/60"
                }`}
              >
                {op.rotulo}
              </button>
            ))}
          </div>
          {erros["material.parcelas"] && (
            <p className="text-sm text-destructive">{erros["material.parcelas"]}</p>
          )}
        </>
      )}
    </div>
  );
}
