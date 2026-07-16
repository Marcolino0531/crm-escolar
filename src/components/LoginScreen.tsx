import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
    setLoading(false);
  }

  async function handleForgotPassword() {
    if (!email) {
      toast.error("Informe o seu e-mail para receber o link de recuperação.");
      return;
    }
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });
    setSendingReset(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-primary/10">
            <img
              src="/school-hub-logo.svg"
              alt="School Hub"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <CardTitle className="text-xl">School Hub</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Acesse com seu e-mail e senha</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Aguarde…" : "Entrar"}
            </Button>
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={sendingReset}
              className="block w-full text-center text-sm text-primary hover:underline disabled:opacity-60"
            >
              {sendingReset ? "Enviando…" : "Esqueci minha senha"}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              O acesso é restrito. Solicite uma conta ao administrador.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
