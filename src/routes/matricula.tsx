// Página PÚBLICA de matrícula (substitui o Google Forms).
//
// O responsável preenche aluno + pai/mãe + endereço, o formulário valida antes
// de enviar (CPF com dígito verificador, datas, telefone, e-mail) e o envio cai
// no MESMO fluxo do webhook do Forms: `receberMatricula` → Sponte → painel
// /matriculas. O Forms continua funcionando em paralelo.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPhoneBR } from "@/lib/phone";
import { buscarEnderecoPorCep } from "@/lib/viacep";
import { DocumentosMatricula } from "@/components/matricula/DocumentosMatricula";
import { MaterialPedagogico } from "@/components/matricula/MaterialPedagogico";
import { QuestionarioSaude } from "@/components/matricula/QuestionarioSaude";
import { RotinaEscolar } from "@/components/matricula/RotinaEscolar";
import {
  ENDERECO_VAZIO,
  GENEROS_MATRICULA,
  MATERIAL_FORM_VAZIO,
  MATRICULA_FORM_VAZIO,
  ROTINA_FORM_VAZIA,
  SAUDE_FORM_VAZIO,
  serieCalculada,
  validarDocumentosForm,
  validarMaterialForm,
  validarSaudeForm,
  cepCompletoValido,
  formatarCep,
  formatarCpf,
  formValido,
  soDigitos,
  validarMatriculaForm,
  validarRotinaForm,
  type EnderecoForm,
  type ErrosForm,
  type GeneroMatricula,
  type MaterialForm,
  type MatriculaForm,
  type ParentescoForm,
  type DocumentosForm,
  type ResponsavelForm,
  type RotinaForm,
  type SaudeForm,
} from "@/lib/matricula-form";
import {
  configMatriculaPublica,
  enviarMatriculaPublica,
  materialMatriculaPublica,
} from "@/lib/matricula-publica.functions";

// Título neutro: o mesmo link atende todas as unidades (a unidade é escolhida
// no formulário ou vem em ?colegio=).
const OG_TITULO = "Formulário de Matrícula — School Hub";
const OG_DESCRICAO =
  "Preencha os dados do aluno e dos responsáveis para iniciar a matrícula, direto pelo celular.";

export const Route = createFileRoute("/matricula")({
  // /matricula?colegio=CEC deixa o link já apontando para a unidade certa.
  validateSearch: (search: Record<string, unknown>): { colegio: string } => ({
    colegio: typeof search.colegio === "string" ? search.colegio : "",
  }),
  head: () => ({
    meta: [
      { title: OG_TITULO },
      { name: "description", content: OG_DESCRICAO },
      { property: "og:title", content: OG_TITULO },
      { property: "og:description", content: OG_DESCRICAO },
      { property: "og:url", content: "https://schoolhubbr.vercel.app/matricula" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: OG_TITULO },
      { name: "twitter:description", content: OG_DESCRICAO },
    ],
  }),
  component: MatriculaPublicaPage,
});

// ─── Turnstile (Cloudflare) ─────────────────────────────────────────────────

interface TurnstileApi {
  render: (
    alvo: HTMLElement,
    opcoes: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void },
  ) => string;
  reset: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

function CaptchaTurnstile({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const caixa = useRef<HTMLDivElement | null>(null);
  // O callback vive num ref para o widget não ser renderizado de novo a cada
  // digitação do formulário (o pai recria a função em todo render).
  const aoToken = useRef(onToken);
  aoToken.current = onToken;

  useEffect(() => {
    let cancelado = false;

    const renderizar = () => {
      if (cancelado || !caixa.current || !window.turnstile) return;
      caixa.current.innerHTML = "";
      window.turnstile.render(caixa.current, {
        sitekey: siteKey,
        callback: (token) => aoToken.current(token),
        "expired-callback": () => aoToken.current(""),
      });
    };

    if (window.turnstile) {
      renderizar();
      return () => {
        cancelado = true;
      };
    }

    const existente = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT}"]`,
    );
    const script = existente ?? document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.addEventListener("load", renderizar);
    if (!existente) document.head.appendChild(script);

    return () => {
      cancelado = true;
      script.removeEventListener("load", renderizar);
    };
  }, [siteKey]);

  return <div ref={caixa} className="min-h-[65px]" />;
}

const DESCRICAO_ETAPA: Record<1 | 2 | 3 | 4, string> = {
  1: "Etapa 1 de 4 — dados do aluno e dos responsáveis.",
  2: "Etapa 2 de 4 — rotina escolar (início, horários e refeições).",
  3: "Etapa 3 de 4 — questionário de saúde.",
  4: "Etapa 4 de 4 — documentos do aluno e do responsável financeiro.",
};

// ─── Campos ─────────────────────────────────────────────────────────────────

function Campo({
  id,
  label,
  erro,
  children,
  dica,
}: {
  id: string;
  label: string;
  erro?: string;
  children: React.ReactNode;
  dica?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {dica && !erro && <p className="text-xs text-muted-foreground">{dica}</p>}
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}

function BlocoEndereco({
  prefixo,
  endereco,
  erros,
  onChange,
}: {
  prefixo: string;
  endereco: EnderecoForm;
  erros: ErrosForm;
  onChange: (e: EnderecoForm) => void;
}) {
  const [buscando, setBuscando] = useState(false);

  const aoMudarCep = async (valor: string) => {
    const cep = formatarCep(valor);
    onChange({ ...endereco, cep });
    if (!cepCompletoValido(cep)) return;
    setBuscando(true);
    const achado = await buscarEnderecoPorCep(cep);
    setBuscando(false);
    if (achado) onChange({ ...endereco, cep, ...achado });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Campo
        id={`${prefixo}-cep`}
        label="CEP"
        erro={erros[`${prefixo}.cep`]}
        dica={buscando ? "Buscando endereço…" : "Preenchemos rua, bairro e cidade pelo CEP."}
      >
        <Input
          id={`${prefixo}-cep`}
          inputMode="numeric"
          placeholder="00000-000"
          value={endereco.cep}
          onChange={(e) => void aoMudarCep(e.target.value)}
        />
      </Campo>
      <Campo id={`${prefixo}-numero`} label="Número" erro={erros[`${prefixo}.numero`]}>
        <Input
          id={`${prefixo}-numero`}
          value={endereco.numero}
          onChange={(e) => onChange({ ...endereco, numero: e.target.value })}
        />
      </Campo>
      <Campo id={`${prefixo}-logradouro`} label="Rua / Avenida">
        <Input
          id={`${prefixo}-logradouro`}
          value={endereco.logradouro}
          onChange={(e) => onChange({ ...endereco, logradouro: e.target.value })}
        />
      </Campo>
      <Campo id={`${prefixo}-complemento`} label="Complemento (opcional)">
        <Input
          id={`${prefixo}-complemento`}
          value={endereco.complemento}
          onChange={(e) => onChange({ ...endereco, complemento: e.target.value })}
        />
      </Campo>
      <Campo id={`${prefixo}-bairro`} label="Bairro">
        <Input
          id={`${prefixo}-bairro`}
          value={endereco.bairro}
          onChange={(e) => onChange({ ...endereco, bairro: e.target.value })}
        />
      </Campo>
      <Campo id={`${prefixo}-cidade`} label="Cidade">
        <Input
          id={`${prefixo}-cidade`}
          value={endereco.cidade}
          onChange={(e) => onChange({ ...endereco, cidade: e.target.value })}
        />
      </Campo>
    </div>
  );
}

function BlocoResponsavel({
  qual,
  titulo,
  responsavel,
  erros,
  onChange,
}: {
  qual: ParentescoForm;
  titulo: string;
  responsavel: ResponsavelForm;
  erros: ErrosForm;
  onChange: (r: ResponsavelForm) => void;
}) {
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">{titulo}</h2>
        <p className="text-xs text-muted-foreground">
          Se este responsável não existir no cadastro da família, deixe o bloco em branco.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id={`${qual}-nome`} label="Nome completo" erro={erros[`${qual}.nome`]}>
          <Input
            id={`${qual}-nome`}
            value={responsavel.nome}
            onChange={(e) => onChange({ ...responsavel, nome: e.target.value })}
          />
        </Campo>
        <Campo id={`${qual}-cpf`} label="CPF" erro={erros[`${qual}.cpf`]}>
          <Input
            id={`${qual}-cpf`}
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={responsavel.cpf}
            onChange={(e) => onChange({ ...responsavel, cpf: formatarCpf(e.target.value) })}
          />
        </Campo>
        <Campo
          id={`${qual}-nascimento`}
          label="Data de nascimento"
          erro={erros[`${qual}.dataNascimento`]}
        >
          <Input
            id={`${qual}-nascimento`}
            type="date"
            value={responsavel.dataNascimento}
            onChange={(e) => onChange({ ...responsavel, dataNascimento: e.target.value })}
          />
        </Campo>
        <Campo id={`${qual}-telefone`} label="Telefone (WhatsApp)" erro={erros[`${qual}.telefone`]}>
          <Input
            id={`${qual}-telefone`}
            inputMode="tel"
            placeholder="(31) 90000-0000"
            value={responsavel.telefone}
            onChange={(e) => onChange({ ...responsavel, telefone: formatPhoneBR(e.target.value) })}
          />
        </Campo>
        <Campo id={`${qual}-email`} label="E-mail" erro={erros[`${qual}.email`]}>
          <Input
            id={`${qual}-email`}
            type="email"
            value={responsavel.email}
            onChange={(e) => onChange({ ...responsavel, email: e.target.value })}
          />
        </Campo>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={responsavel.mesmoEnderecoDoAluno}
          onCheckedChange={(v) => onChange({ ...responsavel, mesmoEnderecoDoAluno: v === true })}
        />
        Mora no mesmo endereço do aluno
      </label>

      {!responsavel.mesmoEnderecoDoAluno && (
        <BlocoEndereco
          prefixo={`${qual}.endereco`}
          endereco={responsavel.endereco}
          erros={erros}
          onChange={(endereco) => onChange({ ...responsavel, endereco })}
        />
      )}
    </section>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────

function hojeLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

function MatriculaPublicaPage() {
  const { colegio } = Route.useSearch();
  const configFn = useServerFn(configMatriculaPublica);
  const enviarFn = useServerFn(enviarMatriculaPublica);

  const config = useQuery({
    queryKey: ["matricula_publica_config"],
    queryFn: async () => configFn(),
  });

  const [form, setForm] = useState<MatriculaForm>({
    ...MATRICULA_FORM_VAZIO,
    endereco: ENDERECO_VAZIO,
  });
  const [rotina, setRotina] = useState<RotinaForm>({ ...ROTINA_FORM_VAZIA });
  const [saude, setSaude] = useState<SaudeForm>({ ...SAUDE_FORM_VAZIO });
  const [documentos, setDocumentos] = useState<DocumentosForm>({});
  const [material, setMaterial] = useState<MaterialForm>({ ...MATERIAL_FORM_VAZIO });
  // 1 = aluno/responsáveis · 2 = rotina · 3 = saúde · 4 = documentos.
  const [etapa, setEtapa] = useState<1 | 2 | 3 | 4>(1);
  const [erros, setErros] = useState<ErrosForm>({});
  const [erroGeral, setErroGeral] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [enviado, setEnviado] = useState(false);

  const unidades = useMemo(() => config.data?.unidades ?? [], [config.data?.unidades]);
  const anosLetivos = useMemo(() => config.data?.anosLetivos ?? [], [config.data?.anosLetivos]);
  // A data do servidor manda: a máquina do responsável pode estar com o relógio
  // errado e reprovar o ano letivo que o envio aceita.
  const hoje = config.data?.hoje ?? hojeLocal();
  // Mesma regra de corte (31/03) da admissão interna, no ano letivo escolhido.
  const serie = serieCalculada(form.aluno.dataNascimento, form.anoLetivo || undefined);

  // Unidade vinda do link (?colegio=CEC) — só quando ela existe de fato.
  useEffect(() => {
    if (form.unidade === "" && colegio !== "" && unidades.includes(colegio)) {
      setForm((atual) => ({ ...atual, unidade: colegio }));
    }
  }, [colegio, unidades, form.unidade]);

  useEffect(() => {
    const primeiro = anosLetivos[0];
    if (form.anoLetivo === 0 && primeiro !== undefined) {
      setForm((atual) => ({ ...atual, anoLetivo: primeiro }));
    }
  }, [anosLetivos, form.anoLetivo]);

  // Valor do material pela unidade + data de nascimento + ano letivo. A série
  // e o valor são resolvidos no servidor; a tela não decide preço.
  const materialFn = useServerFn(materialMatriculaPublica);
  const materialQuery = useQuery({
    queryKey: [
      "matricula_publica_material",
      form.unidade,
      form.aluno.dataNascimento,
      form.anoLetivo,
    ],
    queryFn: async () =>
      materialFn({
        data: {
          unidade: form.unidade,
          dataNascimento: form.aluno.dataNascimento,
          anoLetivo: form.anoLetivo,
        },
      }),
    enabled: form.unidade !== "" && serie !== "" && form.anoLetivo > 0,
  });

  const materialConfigurado = materialQuery.data?.configurado === true;

  const enviar = useMutation({
    mutationFn: async () =>
      enviarFn({ data: { captchaToken, form, rotina, saude, documentos, material } }),
    onSuccess: (res) => {
      if (res.ok) {
        setEnviado(true);
        return;
      }
      setErros(res.erros ?? {});
      setErroGeral(res.erro ?? "Não foi possível enviar o formulário.");
    },
    onError: () =>
      setErroGeral("Não foi possível enviar o formulário agora. Tente novamente em instantes."),
  });

  const errosDaEtapa = (numero: 1 | 2 | 3 | 4): ErrosForm => {
    if (numero === 1) return validarMatriculaForm(form, hoje, unidades);
    if (numero === 2) return validarRotinaForm(rotina, serie, { exigirHorarioCurricular: true });
    if (numero === 3) return validarSaudeForm(saude);
    return {
      ...validarDocumentosForm(documentos, serie),
      ...validarMaterialForm(material, materialConfigurado),
    };
  };

  const avancar = () => {
    const encontrados = errosDaEtapa(etapa);
    setErros(encontrados);
    if (!formValido(encontrados)) {
      setErroGeral("Confira os campos destacados antes de continuar.");
      return;
    }
    setErroGeral("");
    setEtapa((atual) => (atual === 4 ? 4 : ((atual + 1) as 2 | 3 | 4)));
    window.scrollTo({ top: 0 });
  };

  const voltar = () => {
    setErroGeral("");
    setEtapa((atual) => (atual === 1 ? 1 : ((atual - 1) as 1 | 2 | 3)));
    window.scrollTo({ top: 0 });
  };

  const submeter = () => {
    const encontrados = {
      ...validarMatriculaForm(form, hoje, unidades),
      ...validarRotinaForm(rotina, serie, { exigirHorarioCurricular: true }),
      ...validarSaudeForm(saude),
      ...validarDocumentosForm(documentos, serie),
      ...validarMaterialForm(material, materialConfigurado),
    };
    setErros(encontrados);
    if (!formValido(encontrados)) {
      setErroGeral("Confira os campos destacados antes de enviar.");
      return;
    }
    if (captchaToken === "") {
      setErroGeral("Conclua a verificação de segurança abaixo do formulário.");
      return;
    }
    setErroGeral("");
    enviar.mutate();
  };

  if (enviado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
        <div className="w-full max-w-lg space-y-4 rounded-xl border bg-background p-6 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h1 className="text-lg font-semibold">Matrícula enviada com sucesso</h1>
          <p className="text-sm text-muted-foreground">
            Recebemos os dados de <strong>{form.aluno.nome}</strong>. Em breve entraremos em contato
            para concluir a matrícula.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-6 rounded-xl border bg-background p-6 shadow-sm">
        <header className="flex items-start gap-3">
          <GraduationCap className="mt-1 h-6 w-6 shrink-0 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Formulário de matrícula</h1>
            <p className="text-sm text-muted-foreground">{DESCRICAO_ETAPA[etapa]}</p>
          </div>
        </header>

        {config.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}

        {config.data && !config.data.captchaConfigurado && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Formulário temporariamente indisponível.</strong> A verificação de segurança
              não está configurada. Fale com a secretaria do colégio.
            </span>
          </div>
        )}

        {config.data?.captchaConfigurado && (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (etapa === 4) submeter();
              else avancar();
            }}
          >
            <div className={etapa === 1 ? "space-y-6" : "hidden"}>
              <Campo id="unidade" label="Colégio" erro={erros.unidade}>
                <Select
                  value={form.unidade}
                  onValueChange={(unidade) => setForm({ ...form, unidade })}
                >
                  <SelectTrigger id="unidade">
                    <SelectValue placeholder="Escolha o colégio" />
                  </SelectTrigger>
                  <SelectContent>
                    {unidades.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>

              <Campo id="ano-letivo" label="Ano letivo" erro={erros.anoLetivo}>
                <Select
                  value={form.anoLetivo === 0 ? "" : String(form.anoLetivo)}
                  onValueChange={(ano) => setForm({ ...form, anoLetivo: Number(ano) })}
                >
                  <SelectTrigger id="ano-letivo">
                    <SelectValue placeholder="Escolha o ano letivo" />
                  </SelectTrigger>
                  <SelectContent>
                    {anosLetivos.map((ano) => (
                      <SelectItem key={ano} value={String(ano)}>
                        {ano}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>

              <section className="space-y-4 rounded-lg border p-4">
                <h2 className="font-medium">Dados do aluno</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo id="aluno-nome" label="Nome completo" erro={erros["aluno.nome"]}>
                    <Input
                      id="aluno-nome"
                      value={form.aluno.nome}
                      onChange={(e) =>
                        setForm({ ...form, aluno: { ...form.aluno, nome: e.target.value } })
                      }
                    />
                  </Campo>
                  <Campo id="aluno-cpf" label="CPF do aluno" erro={erros["aluno.cpf"]}>
                    <Input
                      id="aluno-cpf"
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      value={form.aluno.cpf}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          aluno: { ...form.aluno, cpf: formatarCpf(e.target.value) },
                        })
                      }
                    />
                  </Campo>
                  <Campo
                    id="aluno-nascimento"
                    label="Data de nascimento"
                    erro={erros["aluno.dataNascimento"]}
                  >
                    <Input
                      id="aluno-nascimento"
                      type="date"
                      value={form.aluno.dataNascimento}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          aluno: { ...form.aluno, dataNascimento: e.target.value },
                        })
                      }
                    />
                    {serie !== "" && (
                      <p className="text-xs text-muted-foreground">
                        Série correspondente: <strong>{serie}</strong>
                      </p>
                    )}
                  </Campo>
                  <Campo id="aluno-genero" label="Gênero" erro={erros["aluno.genero"]}>
                    <Select
                      value={form.aluno.genero}
                      onValueChange={(v) =>
                        setForm({
                          ...form,
                          aluno: { ...form.aluno, genero: v as GeneroMatricula },
                        })
                      }
                    >
                      <SelectTrigger id="aluno-genero">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {GENEROS_MATRICULA.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo
                    id="aluno-naturalidade"
                    label="Naturalidade (cidade de nascimento)"
                    erro={erros["aluno.naturalidade"]}
                  >
                    <Input
                      id="aluno-naturalidade"
                      value={form.aluno.naturalidade}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          aluno: { ...form.aluno, naturalidade: e.target.value },
                        })
                      }
                    />
                  </Campo>
                </div>
              </section>

              <section className="space-y-4 rounded-lg border p-4">
                <h2 className="font-medium">Endereço do aluno</h2>
                <BlocoEndereco
                  prefixo="endereco"
                  endereco={form.endereco}
                  erros={erros}
                  onChange={(endereco) => setForm({ ...form, endereco })}
                />
              </section>

              <BlocoResponsavel
                qual="mae"
                titulo="Dados da mãe"
                responsavel={form.mae}
                erros={erros}
                onChange={(mae) => setForm({ ...form, mae })}
              />

              <BlocoResponsavel
                qual="pai"
                titulo="Dados do pai"
                responsavel={form.pai}
                erros={erros}
                onChange={(pai) => setForm({ ...form, pai })}
              />

              <section className="space-y-3 rounded-lg border p-4">
                <h2 className="font-medium">Responsável financeiro</h2>
                <p className="text-xs text-muted-foreground">
                  Quem receberá os boletos e as comunicações financeiras do colégio.
                </p>
                <Select
                  value={form.responsavelFinanceiro}
                  onValueChange={(v) =>
                    setForm({ ...form, responsavelFinanceiro: v as ParentescoForm })
                  }
                >
                  <SelectTrigger id="responsavel-financeiro">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mae">Mãe</SelectItem>
                    <SelectItem value="pai">Pai</SelectItem>
                  </SelectContent>
                </Select>
                {(erros.responsavelFinanceiro || erros.responsaveis) && (
                  <p className="text-xs text-destructive">
                    {erros.responsavelFinanceiro ?? erros.responsaveis}
                  </p>
                )}
              </section>
            </div>

            {etapa === 2 && (
              <RotinaEscolar
                rotina={rotina}
                erros={erros}
                serie={serie}
                perguntarHorarioCurricular
                onChange={setRotina}
              />
            )}

            {etapa === 3 && <QuestionarioSaude saude={saude} erros={erros} onChange={setSaude} />}

            {etapa === 4 && (
              <>
                <DocumentosMatricula
                  documentos={documentos}
                  erros={erros}
                  onChange={setDocumentos}
                />

                <MaterialPedagogico
                  material={material}
                  dados={materialQuery.data}
                  carregando={materialQuery.isLoading}
                  erros={erros}
                  onChange={setMaterial}
                />

                <CaptchaTurnstile
                  siteKey={config.data.turnstileSiteKey}
                  onToken={(token) => setCaptchaToken(token)}
                />
              </>
            )}

            {erroGeral && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erroGeral}
              </p>
            )}

            {etapa === 1 ? (
              <Button type="submit" className="w-full gap-2">
                Continuar
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <Button
                  type="submit"
                  className="w-full gap-2 sm:flex-1"
                  disabled={enviar.isPending}
                >
                  {etapa === 4 ? (
                    <>
                      {enviar.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Enviar matrícula
                    </>
                  ) : (
                    <>
                      Continuar
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2 sm:w-auto"
                  onClick={voltar}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </Button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
