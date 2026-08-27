import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarOff, CheckCircle2, CreditCard, Loader2, LogIn, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseBRLNumber } from "@/lib/currency";
import {
  VALOR_RECARGA_MAXIMO,
  VALOR_RECARGA_MINIMO,
  formatarBRLRecarga,
  valorRecargaValido,
} from "@/lib/cantina";
import {
  loginPortalCantina,
  solicitarRecargaCantina,
  statusPortalCantina,
  type AlunoPortal,
  type SolicitarRecargaResult,
} from "@/lib/cantina.functions";

export const Route = createFileRoute("/portal-cantina")({
  component: PortalCantinaPage,
});

// Portal PÚBLICO para os responsáveis pedirem recarga do cartão da cantina
// (alternativa à maquininha). Autentica com o CPF do aluno como usuário e senha
// — o CPF fica apenas em memória nesta página e é reenviado na confirmação, de
// modo que o servidor reautentica antes de gravar a solicitação.
function PortalCantinaPage() {
  const login = useServerFn(loginPortalCantina);
  const solicitar = useServerFn(solicitarRecargaCantina);
  const statusFn = useServerFn(statusPortalCantina);

  // Janela do calendário letivo: fora dela nem o formulário aparece (e o
  // servidor recusa login e solicitação de qualquer jeito).
  const status = useQuery({
    queryKey: ["portal_cantina_status"],
    queryFn: async () => statusFn(),
  });

  const [cpf, setCpf] = useState("");
  const [senha, setSenha] = useState("");
  const [aluno, setAluno] = useState<AlunoPortal | null>(null);
  const [erro, setErro] = useState("");
  const [valor, setValor] = useState("");
  const [confirmacao, setConfirmacao] = useState<SolicitarRecargaResult | null>(null);

  const loginMutation = useMutation({
    mutationFn: async () => login({ data: { cpf, senha } }),
    onSuccess: (res) => {
      if (!res.aluno) {
        setErro(res.erro ?? "Não foi possível entrar.");
        return;
      }
      setErro("");
      setAluno(res.aluno);
    },
    onError: () => setErro("Não foi possível entrar agora. Tente novamente em instantes."),
  });

  const valorNumero = parseBRLNumber(valor);
  const valorOk = valorRecargaValido(valorNumero);

  const solicitarMutation = useMutation({
    mutationFn: async () => solicitar({ data: { cpf, senha, valor: valorNumero } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErro(res.erro ?? "Não foi possível registrar a solicitação.");
        return;
      }
      setErro("");
      setConfirmacao(res);
    },
    onError: () => setErro("Não foi possível registrar a solicitação agora. Tente novamente."),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <CreditCard className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Recarga do cartão da cantina</h1>
            <p className="text-sm text-muted-foreground">
              Solicite a recarga e pague junto com a mensalidade.
            </p>
          </div>
        </div>

        {status.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}

        {status.data && !status.data.aberto && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Recarga temporariamente indisponível.</strong> {status.data.mensagem}
            </span>
          </div>
        )}

        {erro && status.data?.aberto && (
          <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </p>
        )}

        {!status.data?.aberto ? null : confirmacao?.ok ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Solicitação de {formatarBRLRecarga(confirmacao.valor ?? 0)} registrada para{" "}
                <strong>{confirmacao.alunoNome}</strong>. A equipe da cantina vai efetuar a recarga
                do cartão.
              </span>
            </div>
            <Button asChild className="w-full gap-2">
              <a href={confirmacao.linkWhatsapp} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4" /> Avisar a recepção no WhatsApp
              </a>
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setConfirmacao(null);
                setValor("");
              }}
            >
              Fazer outra solicitação
            </Button>
          </div>
        ) : aluno ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valorOk) solicitarMutation.mutate();
            }}
          >
            <div className="rounded-md border px-3 py-2 text-sm">
              <p className="font-medium">{aluno.nome}</p>
              {aluno.turma && <p className="text-muted-foreground">{aluno.turma}</p>}
              {aluno.responsaveis.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Responsáveis:{" "}
                  {aluno.responsaveis
                    .map((r) => (r.parentesco ? `${r.nome} (${r.parentesco})` : r.nome))
                    .join(", ")}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="valor">Valor da recarga</Label>
              <Input
                id="valor"
                inputMode="decimal"
                placeholder="R$ 0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Entre {formatarBRLRecarga(VALOR_RECARGA_MINIMO)} e{" "}
                {formatarBRLRecarga(VALOR_RECARGA_MAXIMO)}.
              </p>
            </div>

            <Button
              type="submit"
              className="w-full gap-2"
              disabled={!valorOk || solicitarMutation.isPending}
            >
              {solicitarMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Solicitar recarga
            </Button>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              loginMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="cpf">CPF do aluno</Label>
              <Input
                id="cpf"
                inputMode="numeric"
                autoComplete="username"
                placeholder="000.000.000-00"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                placeholder="000.000.000-00"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">A senha é o próprio CPF do aluno.</p>
            </div>

            <Button type="submit" className="w-full gap-2" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              Entrar
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
