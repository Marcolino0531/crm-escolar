// Etapa 2 do formulário público de matrícula: "Rotina Escolar".
//
// Nada preenchido aqui vai para o Sponte — a rotina tem destino próprio
// (student_routine) e, por isso, vive em `RotinaForm`, fora de `MatriculaForm`.
// A grade de refeições usa as mesmas refeições/dias do Diário do Aluno.

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MEALS, WEEKDAYS, type MealKey, type Weekday } from "@/lib/diario";
import {
  DIAS_UTEIS,
  HORARIOS_PADRAO,
  diasAtivosRotina,
  segmentoDaSerie,
  type ErrosForm,
  type HorarioDia,
  type RotinaForm,
} from "@/lib/matricula-form";

function alternar<T>(lista: T[], valor: T): T[] {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
}

export function RotinaEscolar({
  rotina,
  erros,
  serie,
  titulo = "Rotina Escolar",
  descricao = "Quando o aluno começa, em que horários fica no colégio e quais refeições são contratadas.",
  onChange,
}: {
  rotina: RotinaForm;
  erros: ErrosForm;
  // Série calculada: define o quadro fixo de horários (Infantil × Fundamental).
  serie: string;
  titulo?: string;
  descricao?: string;
  onChange: (r: RotinaForm) => void;
}) {
  const ativos = diasAtivosRotina(rotina);
  const padrao = HORARIOS_PADRAO[segmentoDaSerie(serie)];

  const definirHorario = (dia: Weekday, horario: HorarioDia) =>
    onChange({ ...rotina, horarios: { ...rotina.horarios, [dia]: horario } });

  const alternarRefeicao = (meal: MealKey, dia: Weekday) =>
    onChange({
      ...rotina,
      refeicoes: { ...rotina.refeicoes, [meal]: alternar(rotina.refeicoes[meal], dia) },
    });

  const rotulo = (dia: Weekday): string =>
    WEEKDAYS.find((d) => d.value === dia)?.long ?? String(dia);

  return (
    <section className="space-y-5 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">{titulo}</h2>
        <p className="text-xs text-muted-foreground">{descricao}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rotina-inicio">Data de início</Label>
        <Input
          id="rotina-inicio"
          type="date"
          className="sm:max-w-[220px]"
          value={rotina.dataInicio}
          onChange={(e) => onChange({ ...rotina, dataInicio: e.target.value })}
        />
        {erros["rotina.dataInicio"] && (
          <p className="text-xs text-destructive">{erros["rotina.dataInicio"]}</p>
        )}
      </div>

      <div className="space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={rotina.frequenciaParcial}
            onCheckedChange={(v) => onChange({ ...rotina, frequenciaParcial: v === true })}
          />
          Meu filho não frequenta todos os dias úteis (segunda a sexta)
        </label>

        {rotina.frequenciaParcial && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Marque os dias em que ele frequenta:</p>
            <div className="flex flex-wrap gap-3">
              {DIAS_UTEIS.map((dia) => (
                <label key={dia} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={rotina.diasSelecionados.includes(dia)}
                    onCheckedChange={() =>
                      onChange({
                        ...rotina,
                        diasSelecionados: alternar(rotina.diasSelecionados, dia),
                      })
                    }
                  />
                  {rotulo(dia)}
                </label>
              ))}
            </div>
            {erros["rotina.dias"] && (
              <p className="text-xs text-destructive">{erros["rotina.dias"]}</p>
            )}
          </div>
        )}
      </div>

      {/* Períodos com horário fixo do colégio; o preenchimento manual por dia
          existe apenas no Horário Estendido. */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Horários</p>

        <div className="space-y-2 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={rotina.periodoManha}
              onCheckedChange={(v) => onChange({ ...rotina, periodoManha: v === true })}
            />
            <span>
              Manhã — <strong>{padrao.manha.entrada}</strong> às{" "}
              <strong>{padrao.manha.saida}</strong>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={rotina.periodoTarde}
              onCheckedChange={(v) => onChange({ ...rotina, periodoTarde: v === true })}
            />
            <span>
              Tarde — <strong>{padrao.tarde.entrada}</strong> às{" "}
              <strong>{padrao.tarde.saida}</strong>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={rotina.horarioEstendido}
              onCheckedChange={(v) => onChange({ ...rotina, horarioEstendido: v === true })}
            />
            <span>
              Horário Estendido — entra antes ou sai depois dos horários acima
              <span className="block text-xs text-muted-foreground">
                Informe os horários reais de cada dia.
              </span>
            </span>
          </label>
          {erros["rotina.periodos"] && (
            <p className="text-xs text-destructive">{erros["rotina.periodos"]}</p>
          )}
        </div>

        {rotina.horarioEstendido &&
          ativos.map((dia) => {
            const horario = rotina.horarios[dia] ?? { entrada: "", saida: "" };
            return (
              <div key={dia} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <span className="min-w-[72px] text-sm font-medium">{rotulo(dia)}</span>
                  <div className="space-y-1">
                    <Label htmlFor={`rotina-entrada-${dia}`} className="text-xs">
                      Entrada
                    </Label>
                    <Input
                      id={`rotina-entrada-${dia}`}
                      type="time"
                      className="w-[120px]"
                      value={horario.entrada}
                      onChange={(e) => definirHorario(dia, { ...horario, entrada: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`rotina-saida-${dia}`} className="text-xs">
                      Saída
                    </Label>
                    <Input
                      id={`rotina-saida-${dia}`}
                      type="time"
                      className="w-[120px]"
                      value={horario.saida}
                      onChange={(e) => definirHorario(dia, { ...horario, saida: e.target.value })}
                    />
                  </div>
                </div>
                {erros[`rotina.horario.${dia}`] && (
                  <p className="text-xs text-destructive">{erros[`rotina.horario.${dia}`]}</p>
                )}
              </div>
            );
          })}
      </div>

      {/* Refeições contratadas: uma linha por refeição, uma coluna por dia útil.
          Dias que o aluno não frequenta ficam desabilitados. */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Refeições Contratadas do Colégio</p>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={rotina.semRefeicoes}
            onCheckedChange={(v) => onChange({ ...rotina, semRefeicoes: v === true })}
          />
          Não vou contratar nenhuma refeição
        </label>

        <div className={rotina.semRefeicoes ? "overflow-x-auto opacity-50" : "overflow-x-auto"}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-medium">Refeição</th>
                {DIAS_UTEIS.map((dia) => (
                  <th key={dia} className="px-1 py-1 text-center font-medium">
                    {WEEKDAYS.find((d) => d.value === dia)?.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MEALS.map((meal) => (
                <tr key={meal.key} className="border-t">
                  <td className="py-2 pr-2">{meal.label}</td>
                  {DIAS_UTEIS.map((dia) => (
                    <td key={dia} className="px-1 py-2 text-center">
                      <Checkbox
                        aria-label={`${meal.label} — ${rotulo(dia)}`}
                        disabled={rotina.semRefeicoes || !ativos.includes(dia)}
                        checked={rotina.refeicoes[meal.key].includes(dia)}
                        onCheckedChange={() => alternarRefeicao(meal.key, dia)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {erros["rotina.refeicoes"] && (
          <p className="text-xs text-destructive">{erros["rotina.refeicoes"]}</p>
        )}
      </div>
    </section>
  );
}
