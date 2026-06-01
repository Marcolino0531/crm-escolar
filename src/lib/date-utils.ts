// Timezone-safe helpers for ISO date strings (YYYY-MM-DD) stored in the DB.
// These NEVER use `new Date("YYYY-MM-DD")` directly, which would parse as
// UTC midnight and shift one day in negative-offset locales (e.g. BRT).

// Parse "YYYY-MM-DD" into a Local Date at noon (avoids DST/timezone edge cases).
export function parseISODateLocal(iso: string): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

// Format a "YYYY-MM-DD" string as DD/MM/YYYY without any timezone conversion.
export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Build "YYYY-MM-01" key from a "YYYY-MM-DD" ISO string without timezone shift.
export function monthKeyFromISO(iso: string): string {
  const m = String(iso).match(/^(\d{4})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-01`;
}

// Today as "YYYY-MM-DD" in the user's local timezone.
export function todayISOLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
