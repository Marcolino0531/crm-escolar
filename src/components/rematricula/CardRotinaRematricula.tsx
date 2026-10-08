import { formatarBRL } from "@/lib/rematricula";
import { DIAS_UTEIS, REFEICOES_ROTINA } from "@/lib/matricula-form";
import { MEAL_LABEL, WEEKDAYS, type Weekday } from "@/lib/diario";
import type { ExtraPelaRotina } from "@/lib/matricula-faturamento";
import type { RotinaRevisaoRematricula } from "@/lib/rematricula.functions";

const DIA: Record<number, { short: string; long: string }> = Object.fromEntries(
  WEEKDAYS.map((d) => [d.value, d]),
);

function diasPorExtenso(dias: readonly Weekday[]): string {
  const nomes = DIAS_UTEIS.filter((d) => dias.includes(d)).map((d) => DIA[d].long.toLowerCase());
  if (nomes.length === DIAS_UTEIS.length) return "segunda a sexta";
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function periodoTexto(r: RotinaRevisaoRematricula): string {
  if (r.periodoManha && r.periodoTarde) return "Manhã e tarde";
  if (r.periodoManha) return "Manhã";
  if (r.periodoTarde) return "Tarde";
  return "Não informado";
}

/** Rotina salva pelo responsável na rematrícula e o valor mensal de cada Extra
 *  por ela. Só leitura: indicação para o lançamento manual. */
export function CardRotinaRematricula({
  rotina,
  extras,
  carregando,
  erro,
}: {
  rotina: RotinaRevisaoRematricula | null;
  extras: readonly ExtraPelaRotina[];
  carregando: boolean;
  erro: boolean;
}) {
  const refeicoes = rotina
    ? REFEICOES_ROTINA.filter((m) => !rotina.semRefeicoes && rotina.refeicoes[m].length > 0)
    : [];
  return (
    <div className="rounded-md border p-3" data-rotina-rematricula>
      <p className="font-medium">Rotina escolhida pelo responsável</p>
      {carregando ? (
        <p className="mt-2 text-muted-foreground">Carregando a rotina…</p>
      ) : erro ? (
        <p className="mt-2 text-amber-800">Não foi possível ler a rotina agora.</p>
      ) : !rotina ? (
        <p className="mt-2 text-muted-foreground">O responsável não salvou a rotina escolar.</p>
      ) : (
        <>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Dias da semana</dt>
              <dd>{capitalizar(diasPorExtenso(rotina.diasAtivos)) || "Nenhum"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Período</dt>
              <dd>{periodoTexto(rotina)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Horário estendido</dt>
              <dd>
                {rotina.horarioEstendido ? "Sim" : "Não"}
                {rotina.horarioEstendido &&
                  rotina.horarios.map((h) => (
                    <span key={h.weekday} className="block">
                      {DIA[h.weekday]?.short ?? h.weekday} {h.entrada} às {h.saida}
                    </span>
                  ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Refeições</dt>
              <dd>
                {refeicoes.length === 0
                  ? "Sem refeições"
                  : refeicoes.map((m) => (
                      <span key={m} className="block">
                        {MEAL_LABEL[m]}: {diasPorExtenso(rotina.refeicoes[m])}
                      </span>
                    ))}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs font-medium text-muted-foreground">Valor mensal pela rotina</p>
          {extras.length === 0 ? (
            <p className="text-muted-foreground">Nenhum Extra marcado na rotina.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {extras.map((x) => (
                <li key={x.tipo}>
                  <strong>{x.categoria}</strong>
                  {x.pendencia === null ? (
                    <>
                      : {formatarBRL(x.valorMensal)}/mês
                      <span className="block text-xs text-muted-foreground">{x.observacao}</span>
                    </>
                  ) : (
                    <span className="block text-xs text-amber-800">{x.pendencia}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Só indicação para o lançamento manual: nada é lançado no Sponte nem gravado.
          </p>
        </>
      )}
    </div>
  );
}
