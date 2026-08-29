import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, GraduationCap, KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CODIGO_DIGITOS,
  formatarBRL,
  rotuloParcelamentoPrimeira,
  type ParcelamentoPrimeira,
} from "@/lib/rematricula";
import {
  dadosRematricula,
  salvarEscolhaMaterialRematricula,
  sincronizarCadastroRematricula,
  solicitarCodigoRematricula,
  validarCodigoRematricula,
  type DadosRematricula,
  type ResponsavelRematricula,
} from "@/lib/rematricula.functions";

const OG_TITULO = "Rematrícula — School Hub";
const OG_DESCRICAO = "Confirme a rematrícula do seu filho e escolha o parcelamento do material.";

export const Route = createFileRoute("/rematricula")({
  head: () => ({
    meta: [
      { title: OG_TITULO },
      { name: "description", content: OG_DESCRICAO },
      { property: "og:title", content: OG_TITULO },
      { property: "og:description", content: OG_DESCRICAO },
      { property: "og:url", content: "https://schoolhubbr.vercel.app/rematricula" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: RematriculaPage,
});

type Etapa = "cpf" | "codigo" | "portal";

function mascararCpf(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

// Campo somente leitura: nome, CPF, data de nascimento, matrícula e UF não são
// editáveis pelo portal (mudança de documento passa pela secretaria).
function CampoLeitura({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={valor} readOnly className="bg-muted/40" />
    </div>
  );
}

// Campos que o responsável corrige no portal. O telefone digitado aqui vai para o
// campo Celular do Sponte — o Fone Residencial nunca é tocado.
interface EdicaoContato {
  cep: string;
  endereco: string;
  numeroEndereco: string;
  complementoEndereco: string;
  bairro: string;
  cidade: string;
  celular: string;
  email: string;
}

const CAMPOS_CONTATO: { chave: keyof EdicaoContato; label: string }[] = [
  { chave: "celular", label: "Celular" },
  { chave: "email", label: "Email" },
  { chave: "cep", label: "CEP" },
  { chave: "endereco", label: "Endereço" },
  { chave: "numeroEndereco", label: "Número" },
  { chave: "complementoEndereco", label: "Complemento" },
  { chave: "bairro", label: "Bairro" },
  { chave: "cidade", label: "Cidade" },
];

function CamposContato({
  edicao,
  onChange,
}: {
  edicao: EdicaoContato;
  onChange: (chave: keyof EdicaoContato, valor: string) => void;
}) {
  return (
    <>
      {CAMPOS_CONTATO.map(({ chave, label }) => (
        <div key={chave} className="space-y-1">
          <Label className="text-xs text-muted-foreground">{label}</Label>
          <Input value={edicao[chave]} onChange={(e) => onChange(chave, e.target.value)} />
        </div>
      ))}
    </>
  );
}

function contatoDoResponsavel(resp: ResponsavelRematricula): EdicaoContato {
  return {
    cep: resp.cep,
    endereco: resp.endereco,
    numeroEndereco: resp.numero,
    complementoEndereco: resp.complemento,
    bairro: resp.bairro,
    cidade: resp.cidade,
    celular: resp.telefone,
    email: resp.email,
  };
}

function BlocoResponsavel({
  resp,
  edicao,
  onChange,
}: {
  resp: ResponsavelRematricula;
  edicao: EdicaoContato;
  onChange: (chave: keyof EdicaoContato, valor: string) => void;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{resp.parentesco || "Responsável"}</h3>
        {resp.financeiro && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            Responsável financeiro
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoLeitura label="Nome" valor={resp.nome} />
        <CampoLeitura label="CPF" valor={resp.cpf} />
        <CampoLeitura label="Data de nascimento" valor={resp.dataNascimento} />
        <CampoLeitura label="UF" valor={resp.uf} />
        <CamposContato edicao={edicao} onChange={onChange} />
      </div>
    </div>
  );
}

// Portal PÚBLICO de Rematrícula. O acesso é por CPF do aluno + código de 6
// dígitos enviado no WhatsApp do responsável financeiro cadastrado no Sponte; o
// token de sessão devolvido pelo servidor tem validade curta e vive apenas na
// memória desta página (nada em localStorage).
function RematriculaPage() {
  const pedirCodigo = useServerFn(solicitarCodigoRematricula);
  const validar = useServerFn(validarCodigoRematricula);
  const carregar = useServerFn(dadosRematricula);
  const salvar = useServerFn(salvarEscolhaMaterialRematricula);
  const sincronizar = useServerFn(sincronizarCadastroRematricula);

  const [etapa, setEtapa] = useState<Etapa>("cpf");
  const [cpf, setCpf] = useState("");
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [token, setToken] = useState("");
  const [dados, setDados] = useState<DadosRematricula | null>(null);
  const [parcelas, setParcelas] = useState<number | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [contatoAluno, setContatoAluno] = useState<EdicaoContato | null>(null);
  const [contatoResp, setContatoResp] = useState<Record<string, EdicaoContato>>({});
  const [cadastroSalvo, setCadastroSalvo] = useState("");

  const solicitar = useMutation({
    mutationFn: async () => pedirCodigo({ data: { cpf } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErro(res.mensagem);
        return;
      }
      setErro("");
      setAviso(res.mensagem);
      setCodigo("");
      setEtapa("codigo");
    },
    onError: () => setErro("Não foi possível enviar o código agora. Tente novamente."),
  });

  const entrar = useMutation({
    mutationFn: async () => {
      const res = await validar({ data: { cpf, codigo } });
      if (!res.ok || !res.token) throw new Error(res.erro ?? "Código inválido.");
      const portal = await carregar({ data: { token: res.token } });
      return { token: res.token, portal };
    },
    onSuccess: ({ token: novoToken, portal }) => {
      if (!portal.ok) {
        setErro(portal.erro ?? "Não foi possível carregar seus dados.");
        return;
      }
      setErro("");
      setAviso("");
      setToken(novoToken);
      setDados(portal);
      if (portal.aluno) {
        setContatoAluno({
          cep: portal.aluno.cep,
          endereco: portal.aluno.endereco,
          numeroEndereco: portal.aluno.numero,
          complementoEndereco: portal.aluno.complemento,
          bairro: portal.aluno.bairro,
          cidade: portal.aluno.cidade,
          celular: portal.aluno.telefone,
          email: portal.aluno.email,
        });
      }
      setContatoResp(
        Object.fromEntries(
          (portal.responsaveis ?? []).map((r) => [r.responsavelId, contatoDoResponsavel(r)]),
        ),
      );
      setParcelas(portal.material?.escolhaAtual?.parcelas ?? null);
      setSalvo(!!portal.material?.escolhaAtual);
      setEtapa("portal");
    },
    onError: (e) => setErro(e instanceof Error ? e.message : "Código inválido."),
  });

  const confirmar = useMutation({
    mutationFn: async () => salvar({ data: { token, parcelas: parcelas ?? 0 } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErro(res.erro ?? "Não foi possível salvar sua escolha.");
        return;
      }
      setErro("");
      setSalvo(true);
    },
    onError: () => setErro("Não foi possível salvar sua escolha agora. Tente novamente."),
  });

  // Correção cadastral: vai direto para o Sponte (o servidor relê a ficha inteira
  // antes de escrever) e só os campos alterados entram no payload.
  const enviarCadastro = useMutation({
    mutationFn: async () =>
      sincronizar({
        data: {
          token,
          aluno: contatoAluno ?? undefined,
          responsaveis: Object.entries(contatoResp).map(([responsavelId, edicao]) => ({
            responsavelId,
            ...edicao,
          })),
        },
      }),
    onSuccess: (res) => {
      const falhas = res.falhas ?? [];
      if (!res.ok) {
        setCadastroSalvo("");
        setErro(
          res.erro ||
            falhas.map((f) => `${f.escopo}: ${f.erro}`).join(" — ") ||
            "Não foi possível atualizar seus dados.",
        );
        return;
      }
      setErro("");
      const total = (res.alteracoes ?? []).length;
      setCadastroSalvo(
        total === 0
          ? "Nenhuma alteração para enviar — seus dados já estão como no cadastro da escola."
          : `${total} ${total === 1 ? "campo atualizado" : "campos atualizados"} no cadastro da escola.`,
      );
    },
    onError: () => setErro("Não foi possível atualizar seus dados agora. Tente novamente."),
  });

  const aluno = dados?.aluno;
  const material = dados?.material;
  const opcoes: ParcelamentoPrimeira[] = material?.opcoes ?? [];

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-xl border bg-background p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <GraduationCap className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Rematrícula</h1>
            <p className="text-sm text-muted-foreground">
              Revise os dados, confira a mensalidade e escolha o parcelamento do material.
            </p>
          </div>
        </div>

        {erro && (
          <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </p>
        )}

        {etapa === "cpf" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              solicitar.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="cpf">CPF do aluno</Label>
              <Input
                id="cpf"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                value={mascararCpf(cpf)}
                onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))}
              />
              <p className="text-xs text-muted-foreground">
                Enviaremos um código de {CODIGO_DIGITOS} dígitos no WhatsApp do responsável
                financeiro cadastrado na escola.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={solicitar.isPending}>
              {solicitar.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Lock className="mr-2 h-4 w-4" />
              )}
              Receber código
            </Button>
          </form>
        )}

        {etapa === "codigo" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              entrar.mutate();
            }}
          >
            {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}
            <div className="space-y-1">
              <Label htmlFor="codigo">Código recebido</Label>
              <Input
                id="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={codigo}
                onChange={(e) =>
                  setCodigo(e.target.value.replace(/\D/g, "").slice(0, CODIGO_DIGITOS))
                }
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={entrar.isPending || codigo.length !== CODIGO_DIGITOS}
            >
              {entrar.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              Entrar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setErro("");
                setEtapa("cpf");
              }}
            >
              Informar outro CPF
            </Button>
          </form>
        )}

        {etapa === "portal" && aluno && (
          <div className="space-y-6">
            <div className="rounded-lg border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Aluno</h2>
                <span className="text-xs text-muted-foreground">
                  {aluno.turma || "Turma não informada"} · {dados?.unidade}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <CampoLeitura label="Nome" valor={aluno.nome} />
                <CampoLeitura label="CPF" valor={aluno.cpf} />
                <CampoLeitura label="Matrícula" valor={aluno.matricula} />
                <CampoLeitura label="Data de nascimento" valor={aluno.dataNascimento} />
                <CampoLeitura label="Série atual" valor={aluno.serie} />
                <CampoLeitura label="UF" valor={aluno.uf} />
                {contatoAluno && (
                  <CamposContato
                    edicao={contatoAluno}
                    onChange={(chave, valor) => {
                      setContatoAluno((atual) => (atual ? { ...atual, [chave]: valor } : atual));
                      setCadastroSalvo("");
                    }}
                  />
                )}
              </div>
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Corrija endereço, celular e email se algo estiver desatualizado. Nome, CPF e data de
                nascimento só a secretaria altera.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <h2 className="mb-3 text-sm font-semibold">Mensalidade vigente</h2>
              {dados?.mensalidade ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <CampoLeitura label="Valor" valor={formatarBRL(dados.mensalidade.valor)} />
                  <CampoLeitura
                    label="Desconto aplicado"
                    valor={
                      dados.mensalidade.descontoPercentual > 0
                        ? `${dados.mensalidade.descontoPercentual.toLocaleString("pt-BR")}%`
                        : "Sem desconto"
                    }
                  />
                  <CampoLeitura label="Vencimento" valor={dados.mensalidade.vencimento} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Não encontramos a mensalidade vigente no sistema da escola. Fale com a secretaria.
                </p>
              )}
            </div>

            {dados?.responsaveis && dados.responsaveis.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Responsáveis</h2>
                {dados.responsaveis.map((r) => (
                  <BlocoResponsavel
                    key={r.responsavelId}
                    resp={r}
                    edicao={contatoResp[r.responsavelId] ?? contatoDoResponsavel(r)}
                    onChange={(chave, valor) => {
                      setContatoResp((atual) => ({
                        ...atual,
                        [r.responsavelId]: {
                          ...(atual[r.responsavelId] ?? contatoDoResponsavel(r)),
                          [chave]: valor,
                        },
                      }));
                      setCadastroSalvo("");
                    }}
                  />
                ))}
              </div>
            )}

            <div className="rounded-lg border p-4">
              <Button
                className="w-full"
                variant="secondary"
                disabled={enviarCadastro.isPending}
                onClick={() => enviarCadastro.mutate()}
              >
                {enviarCadastro.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar dados cadastrais
              </Button>
              {cadastroSalvo && (
                <p className="mt-3 flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {cadastroSalvo}
                </p>
              )}
            </div>

            <div className="rounded-lg border p-4">
              <h2 className="mb-1 text-sm font-semibold">Material pedagógico</h2>
              {material?.configurado ? (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Série {material.serie} — valor anual de {formatarBRL(material.valorAnual)}.
                    Escolha em quantas parcelas quer pagar.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {opcoes.map((op) => (
                      <button
                        key={op.parcelas}
                        type="button"
                        onClick={() => {
                          setParcelas(op.parcelas);
                          setSalvo(false);
                        }}
                        className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                          parcelas === op.parcelas
                            ? "border-primary bg-primary/10"
                            : "hover:bg-muted/60"
                        }`}
                      >
                        {rotuloParcelamentoPrimeira(op)}
                      </button>
                    ))}
                  </div>
                  <Button
                    className="mt-4 w-full"
                    disabled={!parcelas || confirmar.isPending || salvo}
                    onClick={() => confirmar.mutate()}
                  >
                    {confirmar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {salvo ? "Escolha registrada" : "Confirmar parcelamento"}
                  </Button>
                  {salvo && parcelas && (
                    <p className="mt-3 flex items-center gap-2 text-sm text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" />
                      Registramos sua escolha de {parcelas}x. A secretaria vai revisar e, depois da
                      conferência, emitir os boletos do material — eles não são gerados neste
                      momento.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  O valor do material da série do aluno ainda não está disponível. Fale com a
                  secretaria.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
