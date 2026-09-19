import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Copy,
  Download,
  ExternalLink,
  FileText,
  GraduationCap,
  Loader2,
  LogOut,
  Mail,
  MailX,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LINK_VALIDADE_MINUTOS, MENSAGEM_LINK_INVALIDO } from "@/lib/rematricula";
import {
  CHAVE_SESSAO_PORTAL,
  ROTULO_STATUS_CONTRATO,
  type AlunoPortal,
} from "@/lib/portal-responsavel";
import {
  dadosSessaoPortal,
  gerarDeclaracaoDebitosPortal,
  gerarDeclaracaoIRPortal,
  listarBoletosPortal,
  listarContratosPortal,
  logoUnidadePortal,
  solicitarLinkPortal,
  validarLinkPortal,
  type SessaoPortalCliente,
} from "@/lib/portal-responsavel.functions";
import { formatarDataBR } from "@/lib/recibos";
import { formatBRLInput } from "@/lib/currency";
import { montarDeclaracaoDebitos } from "@/lib/declaracoes";
import { baixarPdfDeclaracao } from "@/lib/declaracao-pdf";
import { anoIRPadrao, anosIRDisponiveis, montarDeclaracaoIR } from "@/lib/imposto-renda";
import { baixarPdfDeclaracaoIR } from "@/lib/declaracao-ir-pdf";
import { montarTermoDoSnapshot } from "@/lib/confissao-divida";
import { baixarPdfTermoConfissao } from "@/lib/confissao-divida-pdf";
import { carregarLogo } from "@/lib/documento-pdf";

// Portal PÚBLICO do Responsável: login por CPF do responsável + link mágico por
// email; a sessão (sessionStorage) aponta para a LISTA de alunos ativos no ano
// vigente, possivelmente em unidades diferentes. Nada aqui usa o login interno.
export const Route = createFileRoute("/portal")({
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === "string" && search.token ? { token: search.token } : {},
  component: PortalPage,
});

function mascararCpf(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

type Sessao = Omit<SessaoPortalCliente, "expiraEm">;

function PortalPage() {
  const { token: tokenDoLink } = Route.useSearch();
  const navigate = useNavigate();
  const validar = useServerFn(validarLinkPortal);
  const reabrir = useServerFn(dadosSessaoPortal);
  const pedirLink = useServerFn(solicitarLinkPortal);

  const [abrindo, setAbrindo] = useState(true);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [cpf, setCpf] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const jaTentou = useRef(false);

  const sair = () => {
    sessionStorage.removeItem(CHAVE_SESSAO_PORTAL);
    setSessao(null);
    setAviso("");
    setErro("");
  };

  // Link mágico (?token=) tem prioridade; sem ele, tenta reabrir a sessão da aba.
  useEffect(() => {
    if (jaTentou.current) return;
    jaTentou.current = true;
    let ativo = true;
    void (async () => {
      try {
        if (tokenDoLink) {
          if (tokenDoLink.length < 16) {
            setErro(MENSAGEM_LINK_INVALIDO);
            return;
          }
          const res = await validar({ data: { token: tokenDoLink } });
          if (!ativo) return;
          if (!res.ok || !res.sessao) {
            setErro(res.erro ?? MENSAGEM_LINK_INVALIDO);
            return;
          }
          sessionStorage.setItem(CHAVE_SESSAO_PORTAL, res.sessao.token);
          setSessao(res.sessao);
          void navigate({ to: "/portal", search: {}, replace: true });
          return;
        }
        const guardado = sessionStorage.getItem(CHAVE_SESSAO_PORTAL);
        if (!guardado) return;
        const res = await reabrir({ data: { token: guardado } });
        if (!ativo) return;
        if (!res.ok || !res.sessao) {
          sessionStorage.removeItem(CHAVE_SESSAO_PORTAL);
          setErro(res.erro ?? "");
          return;
        }
        setSessao({ token: guardado, ...res.sessao });
      } catch {
        if (ativo) setErro("Não foi possível abrir o portal agora. Tente novamente.");
      } finally {
        if (ativo) setAbrindo(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [navigate, reabrir, tokenDoLink, validar]);

  const solicitar = useMutation({
    mutationFn: async () => pedirLink({ data: { cpf } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setAviso("");
        setErro(res.mensagem);
        return;
      }
      setErro("");
      setAviso(res.mensagem);
    },
    onError: () => setErro("Não foi possível enviar o link agora. Tente novamente."),
  });

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl rounded-xl border bg-background p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <GraduationCap className="h-6 w-6 text-primary" />
            <h1 className="text-lg font-semibold">Portal do Responsável</h1>
          </div>
          {sessao && (
            <Button variant="ghost" size="sm" onClick={sair}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
          )}
        </div>

        {erro && (
          <p className="mb-4 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <MailX className="mt-0.5 h-4 w-4 shrink-0" />
            {erro}
          </p>
        )}

        {abrindo && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {tokenDoLink ? "Validando seu link de acesso…" : "Carregando…"}
          </p>
        )}

        {!abrindo && !sessao && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              solicitar.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="cpf">CPF do responsável</Label>
              <Input
                id="cpf"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                value={mascararCpf(cpf)}
                onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))}
              />
              <p className="text-xs text-muted-foreground">
                Enviaremos um link de acesso para o email cadastrado na escola. O link vale por{" "}
                {LINK_VALIDADE_MINUTOS} minutos.
              </p>
            </div>
            {aviso && (
              <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">{aviso}</p>
            )}
            <Button type="submit" className="w-full" disabled={solicitar.isPending}>
              {solicitar.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              Enviar link de acesso
            </Button>
          </form>
        )}

        {!abrindo && sessao && <PortalSessao sessao={sessao} onExpirar={sair} />}
      </div>
    </div>
  );
}

function chaveAluno(a: Pick<AlunoPortal, "unidade" | "alunoId">): string {
  return `${a.unidade}::${a.alunoId}`;
}

function PortalSessao({ sessao, onExpirar }: { sessao: Sessao; onExpirar: () => void }) {
  const [chave, setChave] = useState(() => (sessao.alunos[0] ? chaveAluno(sessao.alunos[0]) : ""));
  const aluno = sessao.alunos.find((a) => chaveAluno(a) === chave) ?? sessao.alunos[0] ?? null;

  if (!aluno) {
    return <p className="text-sm text-muted-foreground">Nenhum aluno ativo neste ano letivo.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {sessao.responsavelNome ? `Olá, ${sessao.responsavelNome}` : "Aluno"}
          </h2>
          <span className="text-xs text-muted-foreground">Ano letivo {sessao.anoLetivo}</span>
        </div>
        {sessao.alunos.length > 1 ? (
          <div className="space-y-1">
            <Label htmlFor="aluno">Aluno</Label>
            <select
              id="aluno"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={chaveAluno(aluno)}
              onChange={(e) => setChave(e.target.value)}
            >
              {sessao.alunos.map((a) => (
                <option key={chaveAluno(a)} value={chaveAluno(a)}>
                  {a.nome} — {a.turma} ({a.unidade})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm">
            <span className="font-medium">{aluno.nome}</span>
            <span className="text-muted-foreground">
              {" "}
              — {aluno.turma} · {aluno.unidade}
            </span>
          </p>
        )}
      </div>

      <BoletosAluno key={`b-${chave}`} token={sessao.token} aluno={aluno} onExpirar={onExpirar} />
      <ContratosAluno key={`c-${chave}`} token={sessao.token} aluno={aluno} onExpirar={onExpirar} />
      <DeclaracoesAluno
        key={`d-${chave}`}
        token={sessao.token}
        aluno={aluno}
        onExpirar={onExpirar}
      />
    </div>
  );
}

interface SecaoProps {
  token: string;
  aluno: AlunoPortal;
  onExpirar: () => void;
}

function tratarErro(e: unknown, onExpirar: () => void): string {
  const msg = e instanceof Error ? e.message : "Falha ao carregar.";
  if (/sess[ãa]o/i.test(msg)) onExpirar();
  return msg;
}

function BoletosAluno({ token, aluno, onExpirar }: SecaoProps) {
  const listar = useServerFn(listarBoletosPortal);
  const q = useQuery({
    queryKey: ["portal_boletos", aluno.unidade, aluno.alunoId],
    queryFn: async () =>
      listar({ data: { token, unidade: aluno.unidade, alunoId: aluno.alunoId } }),
    retry: false,
  });

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Linha digitável copiada.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o código e copie manualmente.");
    }
  };

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Receipt className="h-4 w-4" /> 2ª via de boleto
      </h2>
      {q.isPending && <Carregando />}
      {q.isError && <p className="text-sm text-destructive">{tratarErro(q.error, onExpirar)}</p>}
      {q.data?.indisponivel && (
        <p className="text-sm text-muted-foreground">
          Consulta indisponível no momento. Tente novamente mais tarde.
        </p>
      )}
      {q.data && !q.data.indisponivel && q.data.boletos.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum boleto em aberto.</p>
      )}
      {q.data && q.data.boletos.length > 0 && (
        <ul className="divide-y">
          {q.data.boletos.map((b, i) => (
            <li key={`${b.vencimento}-${i}`} className="space-y-1 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  Vencimento {formatarDataBR(b.vencimento)}
                  {b.categorias.length > 0 && (
                    <span className="text-muted-foreground"> · {b.categorias.join(", ")}</span>
                  )}
                  {b.vencido && (
                    <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                      vencido
                    </span>
                  )}
                </span>
                <span className="font-medium">
                  R$ {formatBRLInput(b.valorAtualizado)}
                  {b.vencido && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (original R$ {formatBRLInput(b.valorOriginal)})
                    </span>
                  )}
                </span>
              </div>
              {b.linhaDigitavel ? (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-muted px-2 py-1 text-xs">
                    {b.linhaDigitavel}
                  </code>
                  <Button size="sm" variant="outline" onClick={() => void copiar(b.linhaDigitavel)}>
                    <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Linha digitável indisponível para este boleto. Fale com a secretaria.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.boletos.length > 1 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Valores vencidos já incluem multa e juros até hoje. Total: R${" "}
          {formatBRLInput(q.data.totalAtualizado)}.
        </p>
      )}
    </section>
  );
}

function ContratosAluno({ token, aluno, onExpirar }: SecaoProps) {
  const listar = useServerFn(listarContratosPortal);
  const buscarLogo = useServerFn(logoUnidadePortal);
  const q = useQuery({
    queryKey: ["portal_contratos", aluno.unidade, aluno.alunoId],
    queryFn: async () =>
      listar({ data: { token, unidade: aluno.unidade, alunoId: aluno.alunoId } }),
    retry: false,
  });

  const baixarTermo = useMutation({
    mutationFn: async (t: NonNullable<typeof q.data>["termos"][number]) => {
      const { logoUrl } = await buscarLogo({
        data: { token, unidade: aluno.unidade, alunoId: aluno.alunoId },
      });
      const logo = logoUrl ? await carregarLogo(logoUrl) : null;
      await baixarPdfTermoConfissao(montarTermoDoSnapshot(t.numero, t.data, t.snapshot), logo);
    },
    onError: (e) => toast.error(tratarErro(e, onExpirar)),
  });

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <FileText className="h-4 w-4" /> Contrato de Matrícula e Termo de Confissão de Dívida
      </h2>
      {q.isPending && <Carregando />}
      {q.isError && <p className="text-sm text-destructive">{tratarErro(q.error, onExpirar)}</p>}
      {q.data && q.data.contratos.length === 0 && q.data.termos.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum documento emitido para este aluno.</p>
      )}
      {q.data && q.data.contratos.length > 0 && (
        <ul className="divide-y">
          {q.data.contratos.map((c) => (
            <li
              key={`${c.anoLetivo}-${c.numeroContrato}`}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <span>
                Contrato de Matrícula {c.anoLetivo}
                {c.numeroContrato && (
                  <span className="text-muted-foreground"> · nº {c.numeroContrato}</span>
                )}
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {ROTULO_STATUS_CONTRATO[c.status]}
                </span>
              </span>
              <span className="flex gap-2">
                {c.linkAssinatura && (
                  <Button size="sm" asChild>
                    <a href={c.linkAssinatura} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" /> Assinar
                    </a>
                  </Button>
                )}
                {c.pdfAssinado && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={c.pdfAssinado} target="_blank" rel="noreferrer">
                      <Download className="mr-1 h-3.5 w-3.5" /> Baixar PDF
                    </a>
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.termos.length > 0 && (
        <ul className="divide-y border-t">
          {q.data.termos.map((t) => (
            <li
              key={t.numero}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <span>
                Termo de Confissão de Dívida nº {t.numero}
                <span className="text-muted-foreground">
                  {" "}
                  · {formatarDataBR(t.data)} · R$ {formatBRLInput(t.valorTotal)}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={baixarTermo.isPending}
                onClick={() => baixarTermo.mutate(t)}
              >
                <Download className="mr-1 h-3.5 w-3.5" /> Baixar PDF
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeclaracoesAluno({ token, aluno, onExpirar }: SecaoProps) {
  const gerarDebitos = useServerFn(gerarDeclaracaoDebitosPortal);
  const gerarIR = useServerFn(gerarDeclaracaoIRPortal);
  const hoje = hojeYMD();
  const [anoIR, setAnoIR] = useState(anoIRPadrao(hoje));
  const params = { token, unidade: aluno.unidade, alunoId: aluno.alunoId };

  const debitos = useMutation({
    mutationFn: async () => {
      const r = await gerarDebitos({ data: params });
      if (!r.ok || !r.colegio || !r.aluno || !r.numero || !r.dataDocumento || !r.pendencias) {
        throw new Error(r.erro ?? "Não foi possível gerar a declaração.");
      }
      const logo = r.logoUrl ? await carregarLogo(r.logoUrl) : null;
      await baixarPdfDeclaracao(
        montarDeclaracaoDebitos({
          numero: r.numero,
          dataDocumento: r.dataDocumento,
          colegio: r.colegio,
          aluno: r.aluno,
          responsaveis: r.responsaveis ?? [],
          pendencias: r.pendencias,
        }),
        logo,
      );
    },
    onSuccess: () => toast.success("Declaração gerada."),
    onError: (e) => toast.error(tratarErro(e, onExpirar)),
  });

  const ir = useMutation({
    mutationFn: async () => {
      const r = await gerarIR({ data: { ...params, anoIR } });
      if (!r.ok || !r.colegio || !r.aluno || !r.numero || !r.dataDocumento) {
        throw new Error(r.erro ?? "Não foi possível gerar a declaração.");
      }
      const logo = r.logoUrl ? await carregarLogo(r.logoUrl) : null;
      await baixarPdfDeclaracaoIR(
        montarDeclaracaoIR({
          numero: r.numero,
          anoIR,
          dataDocumento: r.dataDocumento,
          colegio: r.colegio,
          aluno: r.aluno,
          responsavelNome: r.responsavelNome ?? "",
          responsavelCpf: r.responsavelCpf ?? "",
          parcelas: r.parcelas ?? [],
        }),
        logo,
      );
    },
    onSuccess: () => toast.success("Declaração gerada."),
    onError: (e) => toast.error(tratarErro(e, onExpirar)),
  });

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <FileText className="h-4 w-4" /> Declarações
      </h2>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Declaração de Inexistência de Débitos</p>
            <p className="text-xs text-muted-foreground">
              Emitida na data de hoje; exige que não haja parcela vencida em aberto.
            </p>
          </div>
          <Button size="sm" disabled={debitos.isPending} onClick={() => debitos.mutate()}>
            {debitos.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            Gerar PDF
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <div>
            <p className="text-sm font-medium">Declaração de Imposto de Renda</p>
            <p className="text-xs text-muted-foreground">
              Pagamentos de Matrícula e Mensalidade do ano-calendário {anoIR - 1}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Exercício"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={anoIR}
              onChange={(e) => setAnoIR(Number(e.target.value))}
            >
              {anosIRDisponiveis(hoje).map((a) => (
                <option key={a} value={a}>
                  Exercício {a}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={ir.isPending} onClick={() => ir.mutate()}>
              {ir.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1 h-3.5 w-3.5" />
              )}
              Gerar PDF
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Carregando() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
    </p>
  );
}
