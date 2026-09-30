// Bloco "Matrícula" do formulário público: valor do School Hub (colégio ×
// segmento da série), parcelas com a mesma regra da rematrícula e a data da 1ª
// parcela escolhida pelo responsável dentro da janela da opção escolhida.
//
// Valor, opções e limites vêm do servidor; a tela só mostra e guarda a escolha.

import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ErrosForm, MatriculaCobrancaForm } from "@/lib/matricula-form";
import type { MatriculaCobrancaPublica } from "@/lib/matricula-publica.functions";
import { formatarBRL } from "@/lib/rematricula";

interface Props {
  cobranca: MatriculaCobrancaForm;
  dados: MatriculaCobrancaPublica | undefined;
  carregando: boolean;
  erros: ErrosForm;
  onChange: (cobranca: MatriculaCobrancaForm) => void;
}

export function MatriculaCobranca({ cobranca, dados, carregando, erros, onChange }: Props) {
  const opcao = dados?.opcoes.find((op) => op.parcelas === cobranca.parcelas);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Matrícula</h2>

      {carregando && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Consultando o valor da Matrícula…
        </p>
      )}

      {!carregando && dados && !dados.disponivel && (
        <p className="text-sm text-muted-foreground">{dados.mensagemIndisponivel}</p>
      )}

      {!carregando && dados?.disponivel && (
        <>
          <p className="text-sm text-muted-foreground">
            Série {dados.serie} — valor de {formatarBRL(dados.valor)}
            {dados.valor !== dados.valorCheio ? ` (cheio: ${formatarBRL(dados.valorCheio)})` : ""}.
          </p>
          <p className="text-sm text-muted-foreground">
            {dados.anoEmCurso
              ? dados.textoAnoEmCurso
              : dados.somenteAVista
                ? "Nesta data a Matrícula é paga à vista."
                : "Escolha em quantas parcelas quer pagar."}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {dados.opcoes.map((op) => (
              <button
                key={op.parcelas}
                type="button"
                onClick={() =>
                  onChange({
                    ...cobranca,
                    parcelas: op.parcelas,
                    primeiroVencimento: op.semEscolha
                      ? op.vencimentoMinimo
                      : cobranca.primeiroVencimento,
                  })
                }
                className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                  cobranca.parcelas === op.parcelas
                    ? "border-primary bg-primary/10"
                    : "hover:bg-muted/60"
                }`}
              >
                {op.rotulo}
              </button>
            ))}
          </div>
          {erros["matriculaCobranca.parcelas"] && (
            <p className="text-sm text-destructive">{erros["matriculaCobranca.parcelas"]}</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="matricula-primeiro-vencimento">
              Data da 1ª parcela {cobranca.parcelas <= 1 ? "(pagamento)" : ""}
            </Label>
            <Input
              id="matricula-primeiro-vencimento"
              type="date"
              min={opcao?.vencimentoMinimo}
              max={opcao?.vencimentoMaximo}
              value={cobranca.primeiroVencimento}
              onChange={(e) => onChange({ ...cobranca, primeiroVencimento: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {opcao
                ? `${opcao.textoVencimento} Se cair em fim de semana ou feriado, vence no próximo dia útil.`
                : "Escolha primeiro a quantidade de parcelas."}
            </p>
            {erros["matriculaCobranca.primeiroVencimento"] && (
              <p className="text-sm text-destructive">
                {erros["matriculaCobranca.primeiroVencimento"]}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
