import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Primeiro e último dia (YYYY-MM-DD, em horário local) de um mês/ano. Evita o
// deslocamento de fuso do toISOString() ao construir as strings manualmente.
function monthRange(year: number, month1to12: number): { start: string; end: string } {
  const lastDay = new Date(year, month1to12, 0).getDate();
  return {
    start: `${year}-${pad(month1to12)}-01`,
    end: `${year}-${pad(month1to12)}-${pad(lastDay)}`,
  };
}

// Dois seletores lado a lado (Mês e Ano). Ao escolher qualquer combinação,
// preenche automaticamente o período com o 1º e o último dia do mês. O mês/ano
// exibidos são derivados de `startDate`.
export function MonthYearPicker({
  startDate,
  onChange,
  className,
}: {
  startDate: string;
  onChange: (start: string, end: string) => void;
  className?: string;
}) {
  const now = new Date();
  const [yStr, mStr] = (startDate ?? "").split("-");
  const selectedYear = Number(yStr) || now.getFullYear();
  const selectedMonth = Number(mStr) || now.getMonth() + 1;

  // Faixa curta de anos (evita menu infinito), sempre incluindo o ano selecionado.
  const baseYears: number[] = [];
  for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y++) baseYears.push(y);
  const years = Array.from(new Set([...baseYears, selectedYear])).sort((a, b) => a - b);

  function apply(year: number, month: number) {
    const { start, end } = monthRange(year, month);
    onChange(start, end);
  }

  return (
    <div className={cn("flex items-end gap-2", className)}>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">Mês</label>
        <Select value={String(selectedMonth)} onValueChange={(v) => apply(selectedYear, Number(v))}>
          <SelectTrigger className="h-9 w-[132px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MESES.map((label, i) => (
              <SelectItem key={label} value={String(i + 1)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">Ano</label>
        <Select value={String(selectedYear)} onValueChange={(v) => apply(Number(v), selectedMonth)}>
          <SelectTrigger className="h-9 w-[92px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
