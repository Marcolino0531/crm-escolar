import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, GraduationCap, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LINK_VALIDADE_MINUTOS,
  formatarBRL,
  rotuloParcelamentoPrimeira,
  type ParcelamentoPrimeira,
} from "@/lib/rematricula";
import {
  TODOS_OS_TURNOS,
  formatarDataBR,
  limitesPrimeiroVencimento,
  validarPrimeiroVencimento,
  valorMensalidadeComDesconto,
  type TurnosDisponiveis,
} from "@/lib/rematricula-matricula";
import { CHAVE_SESSAO_REMATRICULA } from "@/lib/rematricula-sessao";
import { buscarEnderecoPorCep } from "@/lib/viacep";
import { RotinaEscolar } from "@/components/matricula/RotinaEscolar";
import {
  ROTINA_FORM_VAZIA,
  formValido,
  validarRotinaForm,
  type ErrosForm,
  type RotinaForm,
} from "@/lib/matricula-form";
import {
  dadosRematricula,
  finalizarRematricula,
  rotinaRematricula,
  salvarEscolhaMaterialRematricula,
  salvarRotinaRematricula,
  sincronizarCadastroRematricula,
  solicitarLinkRematricula,
  type DadosRematricula,
  type ResponsavelRematricula,
} from "@/lib/rematricula.functions";

const OG_TITULO = "Rematrícula — School Hub";
const OG_DESCRICAO = "Confirme a rematrícula do(a) aluno(a) e escolha o parcelamento do material.";

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

type Etapa = "cpf" | "portal";

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

// Ao completar os oito dígitos do CEP, o ViaCEP preenche rua, bairro e cidade;
// os campos continuam editáveis para o caso de a consulta vir incompleta.
function CamposContato({
  edicao,
  onChange,
}: {
  edicao: EdicaoContato;
  onChange: (chave: keyof EdicaoContato, valor: string) => void;
}) {
  const [buscandoCep, setBuscandoCep] = useState(false);

  const aoMudarCep = async (valor: string) => {
    onChange("cep", valor);
    if (valor.replace(/\D/g, "").length !== 8) return;
    setBuscandoCep(true);
    const achado = await buscarEnderecoPorCep(valor);
    setBuscandoCep(false);
    if (!achado) return;
    onChange("endereco", achado.logradouro);
    onChange("bairro", achado.bairro);
    onChange("cidade", achado.cidade);
  };

  return (
    <>
      {CAMPOS_CONTATO.map(({ chave, label }) => (
        <div key={chave} className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {label}
            {chave === "cep" && buscandoCep && " — buscando endereço…"}
          </Label>
          <Input
            value={edicao[chave]}
            onChange={(e) => {
              if (chave === "cep") void aoMudarCep(e.target.value);
              else onChange(chave, e.target.value);
            }}
          />
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

// Portal PÚBLICO de Rematrícula. O acesso é por CPF do aluno + LINK MÁGICO
// enviado por email ao responsável financeiro cadastrado no Sponte (a
// verificação do link fica em /rematricula/verificar). O token de sessão
// devolvido pelo servidor tem validade curta e vive em sessionStorage — a aba
// fechada já perde o acesso, e nada vai para localStorage.
function RematriculaPage() {
  const pedirLink = useServerFn(solicitarLinkRematricula);
  const carregar = useServerFn(dadosRematricula);
  const salvar = useServerFn(salvarEscolhaMaterialRematricula);
  const sincronizar = useServerFn(sincronizarCadastroRematricula);
  const carregarRotina = useServerFn(rotinaRematricula);
  const guardarRotina = useServerFn(salvarRotinaRematricula);
  const finalizar = useServerFn(finalizarRematricula);

  const [etapa, setEtapa] = useState<Etapa>("cpf");
  const [cpf, setCpf] = useState("");
  const [aviso, setAviso] = useState("");
  const [abrindo, setAbrindo] = useState(true);
  const [erro, setErro] = useState("");
  const [token, setToken] = useState("");
  const [dados, setDados] = useState<DadosRematricula | null>(null);
  const [parcelas, setParcelas] = useState<number | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [contatoAluno, setContatoAluno] = useState<EdicaoContato | null>(null);
  const [contatoResp, setContatoResp] = useState<Record<string, EdicaoContato>>({});
  const [cadastroSalvo, setCadastroSalvo] = useState("");
  const [rotina, setRotina] = useState<RotinaForm>({ ...ROTINA_FORM_VAZIA });
  const [errosRotina, setErrosRotina] = useState<ErrosForm>({});
  const [rotinaSalva, setRotinaSalva] = useState("");
  const [rotinaSugerida, setRotinaSugerida] = useState(false);
  const [turnos, setTurnos] = useState<TurnosDisponiveis>(TODOS_OS_TURNOS);
  const [matParcelas, setMatParcelas] = useState<number>(1);
  const [matVencimento, setMatVencimento] = useState("");
  const [errosEnvio, setErrosEnvio] = useState<Record<string, string>>({});
  const [enviadaEm, setEnviadaEm] = useState<string | null>(null);

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

  // A sessão vem do link verificado em /rematricula/verificar: aqui ela só é
  // resgatada da aba e trocada pelos dados do aluno.
  useEffect(() => {
    const guardado = sessionStorage.getItem(CHAVE_SESSAO_REMATRICULA);
    if (!guardado) {
      setAbrindo(false);
      return;
    }
    let ativo = true;
    void (async () => {
      try {
        const portal = await carregar({ data: { token: guardado } });
        if (!ativo) return;
        if (!portal.ok) {
          sessionStorage.removeItem(CHAVE_SESSAO_REMATRICULA);
          setErro(portal.erro ?? "Sua sessão expirou. Informe o CPF para receber um novo link.");
          return;
        }
        setToken(guardado);
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
        if (portal.matricula) {
          setMatParcelas(portal.matricula.escolhaAtual?.parcelas ?? 1);
          setMatVencimento(portal.matricula.escolhaAtual?.primeiroVencimento ?? "");
        }
        setEnviadaEm(portal.enviadaEm ?? null);
        setEtapa("portal");
      } catch {
        if (ativo) setErro("Não foi possível carregar seus dados agora. Tente novamente.");
      } finally {
        if (ativo) setAbrindo(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [carregar]);

  // Sugestão inicial da rotina: envio anterior do próprio aluno ou o plano do
  // Diário do Aluno. Sem nada cadastrado, a etapa abre em branco.
  useEffect(() => {
    if (token === "") return;
    let ativo = true;
    void (async () => {
      try {
        const res = await carregarRotina({ data: { token } });
        if (!ativo || !res.ok || !res.rotina) return;
        setRotina(res.rotina);
        setRotinaSugerida(res.origem !== "");
        if (res.turnos) setTurnos(res.turnos);
      } catch {
        /* etapa segue em branco; o responsável preenche à mão */
      }
    })();
    return () => {
      ativo = false;
    };
  }, [token, carregarRotina]);

  const enviarRotina = useMutation({
    mutationFn: async () => guardarRotina({ data: { token, rotina } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrosRotina(res.erros ?? {});
        setRotinaSalva("");
        setErro(res.erro ?? "Não foi possível salvar a rotina.");
        return;
      }
      setErro("");
      setErrosRotina({});
      setRotinaSalva("Rotina do próximo ano letivo registrada.");
    },
    onError: () => setErro("Não foi possível salvar a rotina agora. Tente novamente."),
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

  // Envio final: grava a escolha da matrícula e registra o envio. Exige rotina e
  // material já salvos (o servidor confere de novo) e o sucesso só aparece depois
  // da resposta positiva — mesmo padrão das demais seções.
  const enviarMatricula = useMutation({
    mutationFn: async () =>
      finalizar({
        data: { token, matricula: { parcelas: matParcelas, primeiroVencimento: matVencimento } },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrosEnvio(res.erros ?? {});
        setErro(res.erro ?? "Não foi possível enviar sua matrícula.");
        return;
      }
      setErro("");
      setErrosEnvio({});
      setEnviadaEm(res.enviadaEm ?? new Date().toISOString());
    },
    onError: () => setErro("Não foi possível enviar sua matrícula agora. Tente novamente."),
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
  const matricula = dados?.matricula;
  const limitesVencimento = matricula
    ? limitesPrimeiroVencimento(matricula.dataPreenchimento)
    : null;
  const mensalidade = dados?.mensalidade;

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

        {abrindo && etapa === "cpf" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </p>
        )}

        {!abrindo && etapa === "cpf" && (
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
                Enviaremos um link de acesso para o email do responsável financeiro cadastrado na
                escola. O link vale por {LINK_VALIDADE_MINUTOS} minutos.
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
                <CampoLeitura
                  label="Data de nascimento"
                  valor={formatarDataBR(aluno.dataNascimento)}
                />
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
              <RotinaEscolar
                rotina={rotina}
                erros={errosRotina}
                serie={aluno.serie}
                perguntarDataInicio={false}
                frequenciaParcialPorSerie
                turnos={turnos}
                titulo="Atualização da Rotina Escolar"
                descricao={
                  rotinaSugerida
                    ? "Confira a rotina que está cadastrada hoje e ajuste o que mudar no próximo ano letivo."
                    : "Informe os horários e as refeições contratadas para o próximo ano letivo."
                }
                onChange={(nova) => {
                  setRotina(nova);
                  setRotinaSalva("");
                }}
              />
              <Button
                className="mt-4 w-full"
                variant="secondary"
                disabled={enviarRotina.isPending}
                onClick={() => {
                  const encontrados = validarRotinaForm(rotina, aluno.serie, {
                    exigirDataInicio: false,
                  });
                  setErrosRotina(encontrados);
                  if (!formValido(encontrados)) {
                    setErro("Confira os campos destacados da rotina.");
                    return;
                  }
                  enviarRotina.mutate();
                }}
              >
                {enviarRotina.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar rotina escolar
              </Button>
              {rotinaSalva && (
                <p className="mt-3 flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {rotinaSalva}
                </p>
              )}
              {errosEnvio["rotina"] && (
                <p className="mt-2 text-xs text-destructive">{errosEnvio["rotina"]}</p>
              )}
            </div>

            {matricula && limitesVencimento && (
              <div className="rounded-lg border p-4">
                <h2 className="mb-1 text-sm font-semibold">Matrícula</h2>
                <p className="text-sm text-muted-foreground">
                  Série {matricula.serie}. Valor da matrícula:{" "}
                  <strong className="text-foreground">{formatarBRL(matricula.valor)}</strong>.
                </p>
                {matricula.somenteAVista ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    A partir de janeiro a matrícula é paga à vista, em parcela única.
                  </p>
                ) : (
                  <>
                    <p className="mb-2 mt-3 text-sm text-muted-foreground">
                      Escolha em quantas parcelas quer pagar.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {matricula.opcoes.map((op) => (
                        <button
                          key={op.parcelas}
                          type="button"
                          disabled={!!enviadaEm}
                          onClick={() => setMatParcelas(op.parcelas)}
                          className={`rounded-md border px-3 py-2 text-left text-sm transition disabled:opacity-60 ${
                            matParcelas === op.parcelas
                              ? "border-primary bg-primary/10"
                              : "hover:bg-muted/60"
                          }`}
                        >
                          {op.parcelas === 1
                            ? `À vista — ${formatarBRL(op.valorPrimeiraParcela)}`
                            : op.valorPrimeiraParcela === op.valorParcela
                              ? `${op.parcelas}x de ${formatarBRL(op.valorParcela)}`
                              : `${op.parcelas}x — 1ª de ${formatarBRL(op.valorPrimeiraParcela)} e ${op.parcelas - 1}x de ${formatarBRL(op.valorParcela)}`}
                        </button>
                      ))}
                    </div>
                    {errosEnvio["matricula.parcelas"] && (
                      <p className="mt-2 text-xs text-destructive">
                        {errosEnvio["matricula.parcelas"]}
                      </p>
                    )}
                  </>
                )}
                <div className="mt-4 space-y-1.5">
                  <Label htmlFor="matricula-vencimento">
                    {matricula.somenteAVista
                      ? "Data de vencimento da parcela única"
                      : "Data de vencimento da 1ª parcela"}
                  </Label>
                  <Input
                    id="matricula-vencimento"
                    type="date"
                    lang="pt-BR"
                    className="sm:max-w-[220px]"
                    min={limitesVencimento.minimo}
                    max={limitesVencimento.maximo}
                    disabled={!!enviadaEm}
                    value={matVencimento}
                    onChange={(e) => {
                      setMatVencimento(e.target.value);
                      setErrosEnvio((atual) =>
                        Object.fromEntries(
                          Object.entries(atual).filter(
                            ([chave]) => chave !== "matricula.primeiroVencimento",
                          ),
                        ),
                      );
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Entre {formatarDataBR(limitesVencimento.minimo)} e{" "}
                    {formatarDataBR(limitesVencimento.maximo)}.
                  </p>
                  {errosEnvio["matricula.primeiroVencimento"] && (
                    <p className="text-xs text-destructive">
                      {errosEnvio["matricula.primeiroVencimento"]}
                    </p>
                  )}
                </div>
                {!matricula.somenteAVista && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    As demais parcelas (2ª em diante) vencem no mesmo dia da mensalidade do aluno em
                    cada mês, como no parcelamento do material pedagógico.
                  </p>
                )}
              </div>
            )}

            <div className="rounded-lg border p-4">
              <h2 className="mb-3 text-sm font-semibold">Mensalidade vigente</h2>
              {mensalidade ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <CampoLeitura label="Valor" valor={formatarBRL(mensalidade.valor)} />
                  <CampoLeitura
                    label="Desconto aplicado"
                    valor={
                      mensalidade.descontoPercentual > 0
                        ? `${mensalidade.descontoPercentual.toLocaleString("pt-BR")}%`
                        : "Sem desconto"
                    }
                  />
                  <CampoLeitura
                    label="Valor com desconto"
                    valor={formatarBRL(
                      valorMensalidadeComDesconto(
                        mensalidade.valor,
                        mensalidade.descontoPercentual,
                      ),
                    )}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Não encontramos a mensalidade vigente no sistema da escola. Fale com a secretaria.
                </p>
              )}
            </div>

            <div className="rounded-lg border p-4">
              <h2 className="mb-1 text-sm font-semibold">Material pedagógico</h2>
              {material?.configurado ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Série {material.serie}
                    {material.anoLetivo ? ` em ${material.anoLetivo}` : ""}.
                  </p>
                  <p className="mt-1 text-sm font-medium">{material.texto}</p>
                  {material.itens.length > 0 && (
                    <div className="mt-3 text-sm text-muted-foreground">
                      <p className="mb-1">Itens inclusos:</p>
                      <ul className="list-disc space-y-0.5 pl-5">
                        {material.itens.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="mb-3 mt-3 text-sm text-muted-foreground">
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
              {errosEnvio["material"] && (
                <p className="mt-2 text-xs text-destructive">{errosEnvio["material"]}</p>
              )}
            </div>

            <div className="rounded-lg border p-4">
              {enviadaEm ? (
                <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <div className="space-y-1">
                    <p className="font-medium">
                      Matrícula registrada com sucesso em {formatarDataBR(enviadaEm.slice(0, 10))}.
                    </p>
                    <p>
                      O contrato de matrícula será enviado em até 2 horas para assinatura eletrônica
                      no email do responsável financeiro cadastrado. Confira a caixa de entrada e
                      também a pasta de spam.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Confira as seções acima (rotina e material já salvos) e finalize a matrícula.
                  </p>
                  <Button
                    className="w-full"
                    disabled={enviarMatricula.isPending || !matricula}
                    onClick={() => {
                      if (!matricula) return;
                      const erroVencimento = validarPrimeiroVencimento(
                        matVencimento,
                        matricula.dataPreenchimento,
                      );
                      if (erroVencimento) {
                        setErrosEnvio({ "matricula.primeiroVencimento": erroVencimento });
                        setErro("Confira a data de vencimento da matrícula.");
                        return;
                      }
                      enviarMatricula.mutate();
                    }}
                  >
                    {enviarMatricula.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Finalizar Matrícula
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
