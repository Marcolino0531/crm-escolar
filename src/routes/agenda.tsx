import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Clock, Phone, GraduationCap, MapPin, Compass } from "lucide-react";
import { useLeads } from "@/lib/crm/hooks";
import { useSchool, usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateBR } from "@/lib/date-utils";
import { displayPhoneBR } from "@/lib/phone";
import type { ColunaKanban, Lead } from "@/lib/crm/types";

export const Route = createFileRoute("/agenda")({
  head: () => ({ meta: [{ title: "Agenda — School Hub" }] }),
  component: AgendaGate,
});

function AgendaGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("agenda"))
    return <AccessDenied message="Você não tem permissão para visualizar a Agenda." />;
  return <AgendaPage />;
}

// Apenas leads com reunião/visita marcada entram no calendário.
const COLUNAS_AGENDADAS: ColunaKanban[] = ["visita-marcada", "negociacao"];
const COLUNA_LABEL: Partial<Record<ColunaKanban, string>> = {
  "visita-marcada": "Visita Marcada",
  negociacao: "Negociação",
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Identidade visual por unidade (cores claras). "baby" antes de "cec" pois
// "CEC Baby" também contém "cec".
function unitColorClasses(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("baby")) return "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100";
  if (n.includes("belvedere")) return "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100";
  if (n.includes("sereno") || n.includes("vale"))
    return "border-green-200 bg-green-50 text-green-800 hover:bg-green-100";
  if (n.includes("cec")) return "border-yellow-200 bg-yellow-50 text-yellow-800 hover:bg-yellow-100";
  return "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100";
}

type CalEvent = { lead: Lead; iso: string; time: string };

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - r.getDay());
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function AgendaPage() {
  const { leads, isLoading } = useLeads();
  const { schools } = useSchool();
  const [mode, setMode] = useState<"mes" | "semana">("mes");
  const [cursor, setCursor] = useState(() => new Date());

  const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? "—";

  // Eventos agrupados por dia (YYYY-MM-DD), já ordenados por horário.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const lead of leads) {
      if (!lead.dataVisita) continue;
      if (!COLUNAS_AGENDADAS.includes(lead.coluna)) continue;
      const iso = String(lead.dataVisita).slice(0, 10);
      const ev: CalEvent = { lead, iso, time: lead.horarioVisita ?? "" };
      const arr = map.get(iso) ?? [];
      arr.push(ev);
      map.set(iso, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    }
    return map;
  }, [leads]);

  const totalAgendados = useMemo(
    () => Array.from(eventsByDay.values()).reduce((acc, a) => acc + a.length, 0),
    [eventsByDay],
  );

  const todayISO = toISO(new Date());

  const title = useMemo(() => {
    if (mode === "mes") {
      return capitalize(cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
    }
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    return `${fmt(start)} – ${fmt(end)} de ${end.getFullYear()}`;
  }, [mode, cursor]);

  const go = (dir: -1 | 1) => {
    setCursor((c) => {
      if (mode === "mes") return new Date(c.getFullYear(), c.getMonth() + dir, 1);
      return addDays(c, dir * 7);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarDays className="h-6 w-6" /> Agenda
          </h1>
          <p className="text-sm text-muted-foreground">
            Visitas e reuniões marcadas no funil de Admissões.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          {totalAgendados} agendamento{totalAgendados === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => go(-1)} aria-label="Anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => go(1)} aria-label="Próximo">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setCursor(new Date())}>
            Hoje
          </Button>
          <span className="ml-2 text-sm font-semibold">{title}</span>
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "mes" | "semana")}>
          <TabsList>
            <TabsTrigger value="mes">Mês</TabsTrigger>
            <TabsTrigger value="semana">Semana</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : mode === "mes" ? (
        <MonthView cursor={cursor} eventsByDay={eventsByDay} todayISO={todayISO} schoolName={schoolName} />
      ) : (
        <WeekView cursor={cursor} eventsByDay={eventsByDay} todayISO={todayISO} schoolName={schoolName} />
      )}
    </div>
  );
}

function MonthView({
  cursor,
  eventsByDay,
  todayISO,
  schoolName,
}: {
  cursor: Date;
  eventsByDay: Map<string, CalEvent[]>;
  todayISO: string;
  schoolName: (id: string) => string;
}) {
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    // 6 semanas cobrem qualquer mês.
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor]);
  const month = cursor.getMonth();

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const iso = toISO(d);
          const events = eventsByDay.get(iso) ?? [];
          const inMonth = d.getMonth() === month;
          const isToday = iso === todayISO;
          return (
            <div
              key={i}
              className={`min-h-[104px] border-b border-r p-1.5 ${i % 7 === 6 ? "border-r-0" : ""} ${
                inMonth ? "" : "bg-muted/20"
              }`}
            >
              <div
                className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  isToday ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/60"
                }`}
              >
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-1">
                {events.map((ev) => (
                  <EventChip key={ev.lead.id} ev={ev} schoolName={schoolName} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  cursor,
  eventsByDay,
  todayISO,
  schoolName,
}: {
  cursor: Date;
  eventsByDay: Map<string, CalEvent[]>;
  todayISO: string;
  schoolName: (id: string) => string;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
      {days.map((d) => {
        const iso = toISO(d);
        const events = eventsByDay.get(iso) ?? [];
        const isToday = iso === todayISO;
        return (
          <div key={iso} className="flex flex-col rounded-lg border bg-card">
            <div className={`flex items-center justify-between border-b px-2 py-1.5 ${isToday ? "bg-primary/10" : "bg-muted/40"}`}>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {WEEKDAYS[d.getDay()]}
              </span>
              <span className={`text-xs ${isToday ? "font-bold text-primary" : ""}`}>{d.getDate()}</span>
            </div>
            <div className="flex min-h-[80px] flex-col gap-1 p-1.5">
              {events.length === 0 ? (
                <span className="px-1 py-2 text-center text-[11px] text-muted-foreground/60">—</span>
              ) : (
                events.map((ev) => <EventChip key={ev.lead.id} ev={ev} schoolName={schoolName} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventChip({ ev, schoolName }: { ev: CalEvent; schoolName: (id: string) => string }) {
  const { lead, time } = ev;
  const alunos = lead.alunos.length > 0 ? lead.alunos.map((a) => a.nome).filter(Boolean) : [lead.nomeAluno];
  const unidade = schoolName(lead.schoolId);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight transition-colors ${unitColorClasses(unidade)}`}
        >
          {time && <span className="shrink-0 font-semibold">{time}</span>}
          <span className="truncate">{lead.nomePaiMae || "Responsável"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{lead.nomePaiMae || "Responsável"}</span>
            {COLUNA_LABEL[lead.coluna] && (
              <Badge variant="secondary" className="text-[10px]">{COLUNA_LABEL[lead.coluna]}</Badge>
            )}
          </div>
          <Row icon={Clock} text={`${formatDateBR(lead.dataVisita)}${time ? ` · ${time}` : ""}`} />
          <Row icon={GraduationCap} text={alunos.join(", ") || "—"} />
          {lead.turma && <Row icon={GraduationCap} text={`Turma: ${lead.turma}`} />}
          {lead.telefone && <Row icon={Phone} text={displayPhoneBR(lead.telefone)} />}
          <Row icon={MapPin} text={unidade} />
          {lead.origem && <Row icon={Compass} text={lead.origem} />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="text-foreground">{text}</span>
    </div>
  );
}
