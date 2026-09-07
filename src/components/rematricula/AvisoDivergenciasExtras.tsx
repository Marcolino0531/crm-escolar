import { AlertTriangle } from "lucide-react";
import { formatarBRL } from "@/lib/rematricula";
import { ROTULO_TIPO_DIVERGENCIA } from "@/lib/rematricula-extras";
import type { DivergenciaExtraAluno } from "@/lib/rematricula-extras.functions";

const ACAO_MANUAL: Record<DivergenciaExtraAluno["tipo"], string> = {
  lancamento_pendente: "lançar no Sponte e configurar no Diário do Aluno",
  remocao_pendente: "cancelar no Sponte e no Diário do Aluno",
  inconsistente: "conferir Sponte × Diário do Aluno",
};

/** Aviso compacto (linha da tabela) ou detalhado (modal) das divergências de
 *  Extras registradas no Finalizar. Só alerta: nada é alterado automaticamente. */
export function AvisoDivergenciasExtras({
  divergencias,
  detalhado = false,
}: {
  divergencias: readonly DivergenciaExtraAluno[];
  detalhado?: boolean;
}) {
  if (divergencias.length === 0) return null;
  const pendentes = divergencias.filter((d) => d.tipo === "lancamento_pendente");

  if (!detalhado) {
    const resumo = pendentes.length > 0 ? pendentes : divergencias;
    return (
      <p className="mt-1 flex items-start gap-1 text-xs text-amber-800" data-aviso-extras>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {pendentes.length > 0 ? "Lançamento pendente" : "Divergência"} de Extras:{" "}
          {resumo.map((d) => d.categoria).join(", ")}
          {pendentes.length > 0 && divergencias.length > pendentes.length
            ? ` (+${divergencias.length - pendentes.length} outra(s))`
            : ""}
        </span>
      </p>
    );
  }

  return (
    <div
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
      data-aviso-extras
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Extras com ação manual pendente
      </p>
      <ul className="mt-2 space-y-1">
        {divergencias.map((d) => (
          <li key={`${d.categoria}|${d.tipo}`}>
            <strong>{d.categoria}</strong>
            {d.valor !== null ? ` (${formatarBRL(d.valor)}/mês)` : ""} —{" "}
            {ROTULO_TIPO_DIVERGENCIA[d.tipo]}: {ACAO_MANUAL[d.tipo]}.
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">
        Nenhum lançamento de Extras é feito automaticamente. A lista completa fica em Diário do
        Aluno → Auditoria Sponte → Divergências pós-rematrícula.
      </p>
    </div>
  );
}
