import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  Phone,
  GraduationCap,
  MapPin,
  Compass,
  Users,
  Plus,
  Trash2,
  UserRound,
  Building2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLeads } from "@/lib/crm/hooks";
import { useReunioes } from "@/lib/agenda.hooks";
import { listAgendaUsers, type AgendaUser } from "@/lib/agenda.functions";
import { useSchool, usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateBR } from "@/lib/date-utils";
import { displayPhoneBR } from "@/lib/phone";
import { toTitleCase } from "@/lib/name-format";
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
  if (n.includes("baby"))
    return "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100";
  if (n.includes("belvedere")) return "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100";
  if (n.includes("sereno") || n.includes("vale"))
    return "border-green-200 bg-green-50 text-green-800 hover:bg-green-100";
  if (n.includes("cec"))
    return "border-yellow-200 bg-yellow-50 text-yellow-800 hover:bg-yellow-100";
  return "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100";
}

// Reuniões manuais têm identidade própria (tons de azul), destacando-as das
// visitas do funil.
const REUNIAO_CLASSES = "border-blue-400 bg-blue-100 text-blue-900 hover:bg-blue-200";

type CalEvent = {
  id: string;
  kind: "visita" | "reuniao";
  iso: string;
  time: string;
  responsavel: string;
  alunos: string[];
  // visita
  unidade?: string;
  telefone?: string;
  turma?: string;
  origem?: string;
  colunaLabel?: string;
  // reuniao
  colaboradores?: string[];
  unitId?: string | null;
};

// CEC e CEC Baby compartilham a mesma coordenação: uma reunião marcada em uma
// aparece também na agenda da outra.
const SHARED_UNIT_NAMES = ["CEC", "CEC Baby"];

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

function leadToEvent(lead: Lead, unidade: string): CalEvent {
  const alunos =
    lead.alunos.length > 0 ? lead.alunos.map((a) => a.nome).filter(Boolean) : [lead.nomeAluno];
  return {
    id: `lead:${lead.id}`,
    kind: "visita",
    iso: String(lead.dataVisita).slice(0, 10),
    time: lead.horarioVisita ?? "",
    responsavel: toTitleCase(lead.nomePaiMae) || "Responsável",
    alunos: alunos.map((a) => toTitleCase(a)).filter(Boolean),
    unidade,
    telefone: lead.telefone,
    turma: lead.turma,
    origem: lead.origem,
    colunaLabel: COLUNA_LABEL[lead.coluna],
  };
}

function AgendaPage() {
  const { leads, isLoading } = useLeads();
  const { reunioes, isLoading: loadingReunioes, adicionarReuniao, removerReuniao } = useReunioes();
  const { schools, selected, schoolFilterIds } = useSchool();
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("agenda");
  const [mode, setMode] = useState<"mes" | "semana">("mes");
  const [cursor, setCursor] = useState(() => new Date());
  const [novaOpen, setNovaOpen] = useState(false);

  const schoolName = (id: string | null | undefined) =>
    (id && schools.find((s) => s.id === id)?.name) || "—";

  const cecId = useMemo(() => schools.find((s) => s.name === "CEC")?.id ?? null, [schools]);

  // Unidades cujas reuniões devem aparecer para a seleção atual do filtro do
  // topo. `null` = todas (respeitando a permissão do usuário via schoolFilterIds).
  // Ao filtrar por CEC ou CEC Baby, mostra as reuniões de AMBAS (coordenação
  // compartilhada); as demais unidades são estritas.
  const reuniaoUnitIds = useMemo<string[] | null>(() => {
    if (selected === "all") return schoolFilterIds;
    const name = schools.find((s) => s.id === selected)?.name ?? "";
    if (SHARED_UNIT_NAMES.includes(name)) {
      return schools.filter((s) => SHARED_UNIT_NAMES.includes(s.name)).map((s) => s.id);
    }
    return [selected];
  }, [selected, schools, schoolFilterIds]);

  // Eventos agrupados por dia (YYYY-MM-DD), já ordenados por horário. Reúne as
  // visitas do funil de Admissões e as reuniões manuais.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    const push = (ev: CalEvent) => {
      const arr = map.get(ev.iso) ?? [];
      arr.push(ev);
      map.set(ev.iso, arr);
    };
    for (const lead of leads) {
      if (!lead.dataVisita) continue;
      if (!COLUNAS_AGENDADAS.includes(lead.coluna)) continue;
      push(leadToEvent(lead, schoolName(lead.schoolId)));
    }
    for (const r of reunioes) {
      // Reuniões antigas sem unidade contam como CEC (ver migração).
      const unit = r.unitId ?? cecId;
      if (reuniaoUnitIds && (!unit || !reuniaoUnitIds.includes(unit))) continue;
      push({
        id: `reuniao:${r.id}`,
        kind: "reuniao",
        iso: r.data,
        time: r.horario,
        responsavel: r.responsavelNome || "Responsável",
        alunos: r.alunoNome ? [r.alunoNome] : [],
        colaboradores: r.colaboradores,
        unitId: unit,
        unidade: schoolName(unit),
      });
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, reunioes, schools, reuniaoUnitIds, cecId]);

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

  const onRemove = (ev: CalEvent) => {
    if (ev.kind !== "reuniao") return;
    removerReuniao(ev.id.replace("reuniao:", ""));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarDays className="h-6 w-6" /> Agenda
          </h1>
          <p className="text-sm text-muted-foreground">
            Visitas do funil de Admissões e reuniões marcadas manualmente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {totalAgendados} agendamento{totalAgendados === 1 ? "" : "s"}
          </Badge>
          {podeEditar && (
            <Button size="sm" onClick={() => setNovaOpen(true)}>
              <Plus className="h-4 w-4" /> Nova Reunião
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => go(-1)}
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => go(1)}
            aria-label="Próximo"
          >
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

      {isLoading || loadingReunioes ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : mode === "mes" ? (
        <MonthView
          cursor={cursor}
          eventsByDay={eventsByDay}
          todayISO={todayISO}
          podeEditar={podeEditar}
          onRemove={onRemove}
        />
      ) : (
        <WeekView
          cursor={cursor}
          eventsByDay={eventsByDay}
          todayISO={todayISO}
          podeEditar={podeEditar}
          onRemove={onRemove}
        />
      )}

      {podeEditar && (
        <NovaReuniaoDialog
          open={novaOpen}
          onOpenChange={setNovaOpen}
          defaultDate={todayISO}
          onSubmit={(input) => {
            adicionarReuniao(input);
            setNovaOpen(false);
          }}
        />
      )}
    </div>
  );
}

function MonthView({
  cursor,
  eventsByDay,
  todayISO,
  podeEditar,
  onRemove,
}: {
  cursor: Date;
  eventsByDay: Map<string, CalEvent[]>;
  todayISO: string;
  podeEditar: boolean;
  onRemove: (ev: CalEvent) => void;
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
          <div
            key={w}
            className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
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
                  isToday
                    ? "bg-primary font-semibold text-primary-foreground"
                    : inMonth
                      ? "text-foreground"
                      : "text-muted-foreground/60"
                }`}
              >
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-1">
                {events.map((ev) => (
                  <EventChip key={ev.id} ev={ev} podeEditar={podeEditar} onRemove={onRemove} />
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
  podeEditar,
  onRemove,
}: {
  cursor: Date;
  eventsByDay: Map<string, CalEvent[]>;
  todayISO: string;
  podeEditar: boolean;
  onRemove: (ev: CalEvent) => void;
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
            <div
              className={`flex items-center justify-between border-b px-2 py-1.5 ${isToday ? "bg-primary/10" : "bg-muted/40"}`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {WEEKDAYS[d.getDay()]}
              </span>
              <span className={`text-xs ${isToday ? "font-bold text-primary" : ""}`}>
                {d.getDate()}
              </span>
            </div>
            <div className="flex min-h-[80px] flex-col gap-1 p-1.5">
              {events.length === 0 ? (
                <span className="px-1 py-2 text-center text-[11px] text-muted-foreground/60">
                  —
                </span>
              ) : (
                events.map((ev) => (
                  <EventChip key={ev.id} ev={ev} podeEditar={podeEditar} onRemove={onRemove} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventChip({
  ev,
  podeEditar,
  onRemove,
}: {
  ev: CalEvent;
  podeEditar: boolean;
  onRemove: (ev: CalEvent) => void;
}) {
  const isReuniao = ev.kind === "reuniao";
  const colorClasses = isReuniao ? REUNIAO_CLASSES : unitColorClasses(ev.unidade ?? "");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight transition-colors ${colorClasses}`}
        >
          {ev.time && <span className="shrink-0 font-semibold">{ev.time}</span>}
          <span className="truncate">{ev.responsavel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{ev.responsavel}</span>
            <Badge
              variant="secondary"
              className={`text-[10px] ${isReuniao ? "bg-blue-100 text-blue-900" : ""}`}
            >
              {isReuniao ? "Reunião" : (ev.colunaLabel ?? "Visita")}
            </Badge>
          </div>
          <Row icon={Clock} text={`${formatDateBR(ev.iso)}${ev.time ? ` · ${ev.time}` : ""}`} />
          {ev.alunos.length > 0 && <Row icon={GraduationCap} text={ev.alunos.join(", ")} />}
          {isReuniao ? (
            <>
              {ev.unidade && ev.unidade !== "—" && <Row icon={Building2} text={ev.unidade} />}
              <Row icon={Users} text={`Equipe: ${ev.colaboradores?.join(", ") || "—"}`} />
            </>
          ) : (
            <>
              {ev.turma && <Row icon={GraduationCap} text={`Turma: ${ev.turma}`} />}
              {ev.telefone && <Row icon={Phone} text={displayPhoneBR(ev.telefone)} />}
              {ev.unidade && <Row icon={MapPin} text={ev.unidade} />}
              {ev.origem && <Row icon={Compass} text={ev.origem} />}
            </>
          )}
          {isReuniao && podeEditar && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start text-destructive hover:text-destructive"
              onClick={() => onRemove(ev)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remover reunião
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="text-foreground">{text}</span>
    </div>
  );
}

function NovaReuniaoDialog({
  open,
  onOpenChange,
  defaultDate,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate: string;
  onSubmit: (input: {
    data: string;
    horario: string;
    responsavelNome: string;
    alunoNome: string;
    colaboradores: string[];
    participanteIds: string[];
    unitId: string;
  }) => void;
}) {
  const { schools, selected } = useSchool();
  const [data, setData] = useState(defaultDate);
  const [horario, setHorario] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [aluno, setAluno] = useState("");
  const [participantes, setParticipantes] = useState<AgendaUser[]>([]);
  const [unitId, setUnitId] = useState("");

  // Reseta o formulário sempre que o modal (re)abre. Pré-seleciona a unidade
  // ativa no filtro do topo, quando houver uma específica.
  const reset = () => {
    setData(defaultDate);
    setHorario("");
    setResponsavel("");
    setAluno("");
    setParticipantes([]);
    setUnitId(selected !== "all" && schools.some((s) => s.id === selected) ? selected : "");
  };

  const handleOpenChange = (v: boolean) => {
    if (v) reset();
    onOpenChange(v);
  };

  const submit = () => {
    onSubmit({
      data,
      horario,
      responsavelNome: responsavel,
      alunoNome: aluno,
      colaboradores: participantes.map((u) => u.name || u.email),
      participanteIds: participantes.map((u) => u.id),
      unitId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Reunião</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="reuniao-data">Data</Label>
              <Input
                id="reuniao-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reuniao-hora">Hora</Label>
              <Input
                id="reuniao-hora"
                type="time"
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="reuniao-responsavel">Nome do Responsável (Mãe/Pai)</Label>
            <Input
              id="reuniao-responsavel"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              placeholder="Ex.: Maria da Silva"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reuniao-aluno">Nome do Aluno(a)</Label>
            <Input
              id="reuniao-aluno"
              value={aluno}
              onChange={(e) => setAluno(e.target.value)}
              placeholder="Ex.: João Pedro"
            />
          </div>
          <div className="space-y-1">
            <Label>Unidade</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a unidade" />
              </SelectTrigger>
              <SelectContent>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Equipe</Label>
            <EquipePicker value={participantes} onChange={setParticipantes} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!data || !unitId}>
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EquipePicker({
  value,
  onChange,
}: {
  value: AgendaUser[];
  onChange: (v: AgendaUser[]) => void;
}) {
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["agenda_users"],
    queryFn: () => listAgendaUsers(),
    staleTime: 5 * 60 * 1000,
  });
  const [busca, setBusca] = useState("");

  const selectedIds = useMemo(() => new Set(value.map((u) => u.id)), [value]);

  const toggle = (u: AgendaUser) => {
    onChange(selectedIds.has(u.id) ? value.filter((x) => x.id !== u.id) : [...value, u]);
  };

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, busca]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start font-normal">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {value.length > 0
              ? value.map((u) => u.name || u.email).join(", ")
              : "Selecione os participantes"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar usuário"
          className="h-8"
        />
        <div className="max-h-52 space-y-1 overflow-y-auto">
          {isLoading && (
            <p className="px-1 py-2 text-xs text-muted-foreground">Carregando usuários…</p>
          )}
          {!isLoading && filtrados.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum usuário encontrado.</p>
          )}
          {filtrados.map((u) => (
            <label
              key={u.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox checked={selectedIds.has(u.id)} onCheckedChange={() => toggle(u)} />
              <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate">{u.name || u.email}</span>
                {u.name && u.email && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {u.email}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
