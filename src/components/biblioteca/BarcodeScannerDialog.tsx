import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { CameraOff, Loader2, ScanBarcode } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { normalizarCodigoExemplar } from "@/lib/biblioteca";

const REGION_ID = "biblioteca-barcode-reader-region";
const REPEAT_COOLDOWN_MS = 3000;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  descricao: string;
  // Recebe o código (12 dígitos) já normalizado. Devolve uma mensagem de
  // resultado para exibir sob a câmera; o leitor continua ativo.
  onCodigo: (codigo: string) => Promise<{ ok: boolean; mensagem: string }>;
};

// Leitor de código de barras (Code 128 / QR) da Biblioteca, no mesmo padrão do
// "Ler QR Code" do Diário (QrScannerDialog): câmera traseira, cooldown de leitura
// repetida e guarda contra processamento concorrente.
export function BarcodeScannerDialog({ open, onOpenChange, titulo, descricao, onCodigo }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const onCodigoRef = useRef(onCodigo);
  useEffect(() => {
    onCodigoRef.current = onCodigo;
  }, [onCodigo]);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; mensagem: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCameraError(null);
    setStarting(true);
    setLast(null);
    processingRef.current = false;
    lastScanRef.current = { code: "", at: 0 };

    const scanner = new Html5Qrcode(REGION_ID, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.QR_CODE],
    });
    scannerRef.current = scanner;
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 160 } },
        (decodedText) => {
          if (processingRef.current) return;
          const now = Date.now();
          const code = normalizarCodigoExemplar(decodedText);
          if (!code) {
            setLast({ ok: false, mensagem: "Código não reconhecido como exemplar da Biblioteca." });
            return;
          }
          if (
            lastScanRef.current.code === code &&
            now - lastScanRef.current.at < REPEAT_COOLDOWN_MS
          ) {
            return;
          }
          lastScanRef.current = { code, at: now };
          processingRef.current = true;
          onCodigoRef
            .current(code)
            .then((r) => setLast(r))
            .catch((e: unknown) =>
              setLast({ ok: false, mensagem: e instanceof Error ? e.message : "Falha." }),
            )
            .finally(() => {
              setTimeout(() => {
                processingRef.current = false;
              }, 800);
            });
        },
        () => {},
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
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-primary" /> {titulo}
          </DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
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
              "rounded-xl border p-3 text-sm",
              last.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700",
            ].join(" ")}
          >
            {last.mensagem}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
