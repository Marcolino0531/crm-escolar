import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-xl pt-10">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">Acesso restrito</h2>
          <p className="text-sm text-muted-foreground">
            {message ?? "Você tem permissão somente de leitura. Solicite acesso ao administrador para usar esta área."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
