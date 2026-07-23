import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Html5Qrcode } from "html5-qrcode";
import { CameraOff, CheckCircle2, Loader2, QrCode, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/app-context";
import { checkSchedule, parseDiarioQrValue, type DiarioStudent } from "@/lib/diario";

const REGION_ID = "diario-qr-reader-region";
// Ignora leituras repetidas do mesmo código dentro deste intervalo (o leitor
// dispara continuamente enquanto o QR fica na frente da câmera).
const REPEAT_COOLDOWN_MS = 4000;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: DiarioStudent[];
};

type LastResult = { ok: boolean; name: string; detail: string; charge: boolean } | null;

export function QrScannerDialog({ open, onOpenChange, students }: Props) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const qc = useQueryClient();

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [last, setLast] = useState<LastResult>(null);
  const [count, setCount] = useState(0);

  // Índice por id, mantido em ref para o callback do leitor ver sempre a versão
  // mais recente sem reiniciar a câmera.
  const studentsRef = useRef(new Map<string, DiarioStudent>());
  useEffect(() => {
    studentsRef.current = new Map(students.map((s) => [s.id, s]));
  }, [students]);

  const handleDecoded = useCallback(
    async (text: string) => {
      if (processingRef.current) return;
      const now = Date.now();
      const code = text.trim();
      if (lastScanRef.current.code === code && now - lastScanRef.current.at < REPEAT_COOLDOWN_MS) {
        return;
      }
      lastScanRef.current = { code, at: now };

      const id = parseDiarioQrValue(code);
      const student = studentsRef.current.get(id);
      if (!student) {
        setLast({
          ok: false,
          name: "Código não reconhecido",
          detail: "Aluno não encontrado nesta unidade.",
          charge: false,
        });
        toast.error("QR inválido", { description: "Aluno não encontrado nesta unidade." });
        return;
      }
      if (!userId) {
        toast.error("Sessão expirada");
        return;
      }

      processingRef.current = true;
      try {
        const sched = checkSchedule(student.schedule);
        const charge = !sched.withinSchedule;
        const { error } = await supabase.from("diario_events" as never).insert({
          student_id: student.id,
          recorded_by: userId,
          event_type: "checkinout",
          meal: null,
          label: "Entrada / Saída",
          extra_charge: charge,
          reason: charge ? "Fora do horário contratado" : null,
        } as never);
        if (error) throw error;

        const hora = new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        });
        setLast({
          ok: true,
          name: student.name,
          detail: `${student.className || "Sem turma"} • ${hora}`,
          charge,
        });
        setCount((c) => c + 1);
        qc.invalidateQueries({ queryKey: ["diario_extra_events"] });
        toast.success("Entrada / Saída registrada", {
          description: `${student.name} • ${hora}${charge ? " • Hora extra gerada" : ""}`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Tente novamente.";
        setLast({ ok: false, name: student.name, detail: msg, charge: false });
        toast.error("Erro ao registrar", { description: msg });
      } finally {
        // Pequena folga para evitar registrar duas vezes o mesmo aluno.
        setTimeout(() => {
          processingRef.current = false;
        }, 800);
      }
    },
    [userId, qc],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCameraError(null);
    setStarting(true);
    setLast(null);
    setCount(0);
    processingRef.current = false;
    lastScanRef.current = { code: "", at: 0 };

    const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
    scannerRef.current = scanner;
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          void handleDecoded(decodedText);
        },
        () => {
          // Erros de decodificação por frame são normais — ignorados.
        },
      )
      .then(() => {
        if (!cancelled) setStarting(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStarting(false);
        setCameraError(e instanceof Error ? e.message : "Não foi possível acessar a câmera.");
      });

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      }
    };
  }, [open, handleDecoded]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" /> Leitura de QR Code
          </DialogTitle>
          <DialogDescription>
            Aponte a câmera para o código do aluno. A Entrada / Saída é registrada automaticamente e
            o leitor continua ativo para o próximo.
          </DialogDescription>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-2xl border border-border bg-black">
          <div id={REGION_ID} className="min-h-[260px] w-full [&_video]:w-full" />
          {starting && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-sm text-white">
              <Loader2 className="h-5 w-5 animate-spin" />
              Iniciando câmera…
            </div>
          )}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white">
              <CameraOff className="h-6 w-6" />
              <span className="font-medium">Não foi possível acessar a câmera</span>
              <span className="text-xs text-white/80">{cameraError}</span>
            </div>
          )}
        </div>

        {last && (
          <div
            className={[
              "flex items-center gap-3 rounded-xl border p-3",
              last.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700",
            ].join(" ")}
          >
            {last.ok ? (
              <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="h-6 w-6 flex-shrink-0 text-red-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{last.name}</p>
              <p className="truncate text-xs">
                {last.detail}
                {last.charge && last.ok ? " • Hora extra" : ""}
              </p>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          {count > 0
            ? `${count} registro(s) nesta sessão de leitura.`
            : "Nenhum registro ainda nesta sessão."}
        </p>
      </DialogContent>
    </Dialog>
  );
}
