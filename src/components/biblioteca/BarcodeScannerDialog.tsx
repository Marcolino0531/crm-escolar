import { useEffect, useId, useRef, useState } from "react";
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
import {
  MAX_FRAMES_AGUARDANDO_REGIAO,
  criarLeitorSeguro,
  encerrarLeitorSeguro,
  mensagemDeErroLeitor,
} from "@/lib/html5-qrcode-safe";

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
  const regionId = `biblioteca-barcode-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startedRef = useRef(false);
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
    startedRef.current = false;
    let frame = 0;
    let tentativas = 0;

    const onDecoded = (decodedText: string) => {
      if (processingRef.current) return;
      const now = Date.now();
      const code = normalizarCodigoExemplar(decodedText);
      if (!code) {
        setLast({ ok: false, mensagem: "Código não reconhecido como exemplar da Biblioteca." });
        return;
      }
      if (lastScanRef.current.code === code && now - lastScanRef.current.at < REPEAT_COOLDOWN_MS) {
        return;
      }
      lastScanRef.current = { code, at: now };
      processingRef.current = true;
      onCodigoRef
        .current(code)
        .then((r) => setLast(r))
        .catch((e: unknown) => setLast({ ok: false, mensagem: mensagemDeErroLeitor(e, "Falha.") }))
        .finally(() => {
          setTimeout(() => {
            processingRef.current = false;
          }, 800);
        });
    };

    const falhar = (e: unknown) => {
      if (cancelled) return;
      setStarting(false);
      setCameraError(mensagemDeErroLeitor(e));
    };

    const iniciar = () => {
      if (cancelled) return;
      // O conteúdo do Dialog é montado num portal: no primeiro efeito a região
      // ainda pode não estar no DOM — espera alguns frames antes de desistir.
      if (!document.getElementById(regionId)) {
        if (++tentativas < MAX_FRAMES_AGUARDANDO_REGIAO) {
          frame = requestAnimationFrame(iniciar);
          return;
        }
        falhar("A área da câmera não foi carregada. Feche e abra o leitor novamente.");
        return;
      }
      const criado = criarLeitorSeguro(regionId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
      });
      if (!criado.ok) {
        falhar(criado.erro);
        return;
      }
      const scanner = criado.leitor;
      scannerRef.current = scanner;
      try {
        scanner
          .start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 280, height: 160 } },
            onDecoded,
            () => {},
          )
          .then(() => {
            startedRef.current = true;
            if (cancelled) {
              encerrarLeitorSeguro(scanner, true);
              return;
            }
            setStarting(false);
          })
          .catch(falhar);
      } catch (e) {
        falhar(e);
      }
    };

    frame = requestAnimationFrame(iniciar);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) encerrarLeitorSeguro(s, startedRef.current);
      startedRef.current = false;
    };
  }, [open, regionId]);

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
          <div id={regionId} className="min-h-[260px] w-full [&_video]:w-full" />
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
