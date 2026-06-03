import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSchool } from "@/lib/app-context";
import { Building2 } from "lucide-react";

export function SchoolFilter() {
  const { selected, setSelected, schools, restricted } = useSchool();
  // A restricted user with a single allowed unit is locked to that unit.
  const lockedSingle = restricted && schools.length === 1;
  // Only restricted users with more than one unit keep a consolidated option.
  const showAll = !restricted || schools.length > 1;
  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select value={selected} onValueChange={setSelected} disabled={lockedSingle}>
        <SelectTrigger className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {showAll && <SelectItem value="all">Consolidado (todos)</SelectItem>}
          {schools.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
