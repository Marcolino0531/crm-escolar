import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, Plus, Scale, Search, Trash2, User, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, usePermissions } from "@/lib/app-context";
import { carregarLogoDoColegio, paraColegioRecibo, useColegios } from "@/lib/colegios";
import { SelecioneUnidade, useUnidadeAtiva } from "@/components/SelecioneUnidade";
import {
  blocoVazio,
  calcularParcelasBlocos,
  devedorDeResponsavel,
  devedorVazio,
  FORMA_PAGAMENTO_PADRAO,
  linhaAluno,
  montarTermoConfissao,
  totalDosBlocos,
  totalParcelasTermo,
  validarTermoConfissao,
  vencimentoSugeridoProximoBloco,
  type AlunoTermo,
  type BlocoParcelamento,
  type DevedorTermo,
  type TermoConfissaoSnapshot,
  type TestemunhaTermo,
} from "@/lib/confissao-divida";
import { baixarPdfTermoConfissao } from "@/lib/confissao-divida-pdf";
import { parseBRLNumber } from "@/lib/currency";
import { formatarBRL, formatarDataBR, valorPorExtenso } from "@/lib/recibos";
import {
  buscarAlunosSponte,
  buscarDadosCadastraisAluno,
  type AlunoBuscaSponte,
  type ResponsavelCadastroSponte,
} from "@/lib/sponte.functions";

// Termo de Confissão de Dívida e Outras Avenças.
//
// Diferente dos outros modelos do módulo: um termo pode citar vários alunos
// (irmãos) e vários devedores, incluindo solidários que não estão no Sponte.
// Tudo é leitura — o parcelamento aqui é a redação do acordo e nada é lançado
// no financeiro do Sponte.

interface AlunoSelecionado {
  aluno: AlunoTermo;
  turma: string;
  responsaveis: ResponsavelCadastroSponte[];
}

/** Chave de identidade da pessoa: o mesmo responsável de dois irmãos é um só. */
function chaveResponsavel(r: ResponsavelCadastroSponte): string {
  const cpf = r.cpf.replace(/\D/g, "");
  return cpf ? `cpf:${cpf}` : `resp:${r.responsavelId}`;
}

// Devedor solidário fora do Sponte (fiador, parente): a qualificação do termo
// precisa dos mesmos dados que o Sponte forneceria.
const CAMPOS_DEVEDOR_MANUAL: {
  campo:
    | "nome"
    | "cpf"
    | "dataNascimento"
    | "endereco"
    | "numero"
    | "complemento"
    | "bairro"
    | "cidade"
    | "uf"
    | "cep"
    | "telefone"
    | "email";
  label: string;
  tipo?: string;
}[] = [
  { campo: "nome", label: "Nome completo" },
  { campo: "cpf", label: "CPF" },
  { campo: "dataNascimento", label: "Data de nascimento", tipo: "date" },
  { campo: "endereco", label: "Endereço (rua/av.)" },
  { campo: "numero", label: "Número" },
  { campo: "complemento", label: "Complemento" },
  { campo: "bairro", label: "Bairro" },
  { campo: "cidade", label: "Cidade" },
  { campo: "uf", label: "UF" },
  { campo: "cep", label: "CEP" },
  { campo: "telefone", label: "Telefone" },
  { campo: "email", label: "E-mail" },
];

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function GerarTermoConfissao() {
  const { canEdit } = usePermissions();
  const { session } = useAuth();
  const qc = useQueryClient();
  const podeEditar = canEdit("documentos");

  const { data: colegios = [] } = useColegios();
  const buscar = useServerFn(buscarAlunosSponte);
  const buscarCadastro = useServerFn(buscarDadosCadastraisAluno);

  const hoje = hojeYMD();
  // Unidade do seletor global do topo: a tela não tem seletor próprio.
  const unidade = useUnidadeAtiva() ?? "";
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  // `alvo` diz o que fazer com o aluno escolhido na busca: entrar no termo como
  // ALUNO(A) ou só emprestar seus responsáveis como devedores solidários.
  const [alvo, setAlvo] = useState<"aluno" | "solidario">("aluno");
  const [alunos, setAlunos] = useState<AlunoSelecionado[]>([]);
  const [extras, setExtras] = useState<ResponsavelCadastroSponte[]>([]);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [manuais, setManuais] = useState<DevedorTermo[]>([]);

  const [anoLetivo, setAnoLetivo] = useState<string>(String(new Date().getFullYear() - 1));
  const [formaPagamento, setFormaPagamento] = useState<string>(FORMA_PAGAMENTO_PADRAO);
  // Um bloco por padrão: o caso comum de parcelas iguais continua sendo dois
  // campos e uma data.
  const [blocos, setBlocos] = useState<BlocoParcelamento[]>([blocoVazio("bloco-1")]);
  const [valoresTexto, setValoresTexto] = useState<Record<string, string>>({});
  const [dataDocumento, setDataDocumento] = useState<string>(hoje);
  const [testemunhas, setTestemunhas] = useState<TestemunhaTermo[]>([
    { nome: "", cpf: "" },
    { nome: "", cpf: "" },
  ]);

  // Trocar a unidade no topo invalida os alunos e devedores da anterior.
  useEffect(() => {
    setResultados(null);
    setAlunos([]);
    setExtras([]);
    setMarcados([]);
  }, [unidade]);

  const colegio = colegios.find((c) => c.unidade === unidade) ?? null;
  const colegioTermo = colegio ? paraColegioRecibo(colegio) : null;

  // Responsáveis disponíveis para marcar como devedores, sem repetir a mesma
  // pessoa que responde por mais de um aluno.
  const candidatos = useMemo(() => {
    const mapa = new Map<string, { responsavel: ResponsavelCadastroSponte; alunos: string[] }>();
    for (const a of alunos) {
      for (const r of a.responsaveis) {
        const chave = chaveResponsavel(r);
        const atual = mapa.get(chave);
        if (atual) atual.alunos.push(a.aluno.nome);
        else mapa.set(chave, { responsavel: r, alunos: [a.aluno.nome] });
      }
    }
    for (const r of extras) {
      const chave = chaveResponsavel(r);
      if (!mapa.has(chave)) mapa.set(chave, { responsavel: r, alunos: [] });
    }
    return [...mapa.entries()].map(([chave, v]) => ({ chave, ...v }));
  }, [alunos, extras]);

  const devedores = useMemo<DevedorTermo[]>(() => {
    const doSponte = marcados
      .map((chave) => candidatos.find((c) => c.chave === chave))
      .filter((c): c is (typeof candidatos)[number] => !!c)
      .map((c) => devedorDeResponsavel(c.responsavel, false));
    // O primeiro devedor é o principal; os demais assinam como solidários.
    return [...doSponte, ...manuais].map((d, i) => ({ ...d, solidario: i > 0 }));
  }, [marcados, candidatos, manuais]);

  const valorTotal = useMemo(() => totalDosBlocos(blocos), [blocos]);
  const parcelas = useMemo(() => calcularParcelasBlocos(blocos), [blocos]);

  const atualizarBloco = (id: string, patch: Partial<BlocoParcelamento>) =>
    setBlocos((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const adicionarBloco = () =>
    setBlocos((prev) => [
      ...prev,
      blocoVazio(`bloco-${Date.now()}`, vencimentoSugeridoProximoBloco(prev)),
    ]);

  const alunosTermo = useMemo(() => alunos.map((a) => a.aluno), [alunos]);
  const testemunhasPreenchidas = useMemo(
    () => testemunhas.filter((t) => t.nome.trim() || t.cpf.trim()),
    [testemunhas],
  );

  const erros = validarTermoConfissao({
    colegio: colegioTermo,
    alunos: alunosTermo,
    devedores,
    anoLetivo,
    formaPagamento,
    blocos,
    dataDocumento,
  });

  const buscarAlunos = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: busca.trim(), unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      return r.alunos;
    },
    onSuccess: (encontrados) => setResultados(encontrados),
    onError: (e) => {
      setResultados(null);
      toast.error(e instanceof Error ? e.message : "Falha na busca.");
    },
  });

  const selecionarAluno = useMutation({
    mutationFn: async (encontrado: AlunoBuscaSponte) => {
      const r = await buscarCadastro({ data: { alunoId: encontrado.alunoId, unidade } });
      if (r.error) throw new Error(r.error);
      return r;
    },
    onSuccess: (r) => {
      if (!r.aluno) {
        toast.error("Aluno não encontrado no Sponte.");
        return;
      }
      if (r.responsaveis.length === 0) {
        toast.error("O aluno não tem responsável cadastrado no Sponte.");
      }
      if (alvo === "solidario") {
        setExtras((prev) => [
          ...prev,
          ...r.responsaveis.filter(
            (novo) => !prev.some((p) => chaveResponsavel(p) === chaveResponsavel(novo)),
          ),
        ]);
        toast.success(`Responsáveis de ${r.aluno.nome} disponíveis para marcar como devedores.`);
      } else if (alunos.some((a) => a.aluno.alunoId === r.aluno?.alunoId)) {
        toast.error("Este aluno já está no termo.");
      } else {
        setAlunos((prev) => [
          ...prev,
          {
            aluno: {
              alunoId: r.aluno?.alunoId ?? "",
              matricula: r.aluno?.matricula ?? "",
              nome: r.aluno?.nome ?? "",
            },
            turma: r.aluno?.turma ?? "",
            responsaveis: r.responsaveis,
          },
        ]);
      }
      setResultados(null);
      setBusca("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar o aluno."),
  });

  const gerar = useMutation({
    mutationFn: async () => {
      if (!colegio || !colegioTermo) throw new Error("Termo incompleto.");
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const snapshot: TermoConfissaoSnapshot = {
        colegio: colegioTermo,
        alunos: alunosTermo,
        devedores,
        testemunhas: testemunhasPreenchidas,
        anoLetivo: anoLetivo.trim(),
        formaPagamento: formaPagamento.trim(),
        valorTotal,
        parcelas,
      };
      const principal = devedores[0];
      // O número impresso vem da sequência do banco: gravamos primeiro e só
      // então montamos o PDF, para documento e histórico não divergirem.
      const { data, error } = await supabase
        .from("documentos_recibos" as never)
        .insert({
          tipo: "termo_confissao_divida",
          unidade,
          aluno_id: alunosTermo[0]?.alunoId ?? "",
          aluno_nome: alunosTermo.map((a) => a.nome).join(" · "),
          responsavel_id: principal?.origem === "sponte" ? principal.id.replace("sponte:", "") : "",
          responsavel_nome: devedores.map((d) => d.nome).join(" · "),
          responsavel_cpf: principal?.cpf ?? "",
          data_recibo: dataDocumento,
          valor_total: valorTotal,
          itens: [],
          snapshot,
          created_by: session?.user?.id ?? null,
          created_by_nome: meta?.full_name || session?.user?.email || "",
        } as never)
        .select("numero")
        .single();
      if (error) throw new Error(error.message);
      const numero = Number((data as unknown as { numero: number }).numero);
      const documento = montarTermoConfissao({ numero, dataDocumento, ...snapshot });
      await baixarPdfTermoConfissao(documento, await carregarLogoDoColegio(colegio.logo_path));
      return numero;
    },
    onSuccess: (numero) => {
      toast.success(`Termo de confissão de dívida nº ${numero} gerado e baixado.`);
      qc.invalidateQueries({ queryKey: ["documentos_recibos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao gerar o termo."),
  });

  const b = busca.trim();
  const buscaValida = /^\d+$/.test(b) ? b.length >= 1 : b.length >= 3;

  if (!podeEditar) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Você tem acesso somente de leitura em Documentos: consulte os documentos já emitidos na aba
        Histórico.
      </div>
    );
  }

  if (!unidade) return <SelecioneUnidade acao="O termo de confissão de dívida" />;

  return (
    <div className="space-y-4">
      {/* Passo 1 — alunos do termo */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Search className="h-4 w-4 text-primary" /> 1. Aluno(s) do termo
          </h2>
          <p className="text-xs text-muted-foreground">
            Use o “+” para incluir irmãos no mesmo termo. Os responsáveis vêm do Sponte apenas por
            leitura: este documento não lança nem altera nada no financeiro.
          </p>
        </header>
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Colégio</Label>
              <div className="flex h-9 w-56 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {unidade}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="termo-busca" className="text-[11px] text-muted-foreground">
                Aluno (nome ou AlunoID do Sponte)
              </Label>
              <Input
                id="termo-busca"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && buscaValida) buscarAlunos.mutate();
                }}
                placeholder="ex.: Giovanna ou 672"
                className="h-9 w-64"
              />
            </div>
            <Button
              variant="outline"
              className="h-9 gap-1"
              disabled={!buscaValida || buscarAlunos.isPending}
              onClick={() => {
                setAlvo("aluno");
                buscarAlunos.mutate();
              }}
            >
              {buscarAlunos.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {alunos.length === 0 ? "Buscar no Sponte" : "Adicionar aluno"}
            </Button>
          </div>

          {resultados && resultados.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Nenhum aluno encontrado para “{b}” em {unidade}.
            </div>
          )}

          {resultados && resultados.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">
                {alvo === "solidario"
                  ? "Escolha o aluno cujos responsáveis entram como devedores solidários (o aluno não é citado no termo)."
                  : "Escolha o aluno que será citado no termo."}
              </div>
              <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {resultados.map((a) => (
                  <button
                    key={a.alunoId}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    disabled={selecionarAluno.isPending}
                    onClick={() => selecionarAluno.mutate(a)}
                  >
                    <span>
                      <span className="font-medium">{a.nome}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        #{a.alunoId} · {a.turma || "sem turma"} · {a.situacao}
                      </span>
                    </span>
                    {selecionarAluno.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <User className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {alunos.map((a) => (
            <div
              key={a.aluno.alunoId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">{linhaAluno(a.aluno)}</div>
                <div className="text-xs text-muted-foreground">
                  {[`#${a.aluno.alunoId}`, a.turma, `${a.responsaveis.length} responsável(is)`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <Button
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => setAlunos((prev) => prev.filter((x) => x !== a))}
              >
                Remover
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Passo 2 — devedores */}
      {alunos.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Users className="h-4 w-4 text-primary" /> 2. Devedor(es)
            </h2>
            <p className="text-xs text-muted-foreground">
              Marque quem consta como DEVEDOR. O primeiro marcado é o devedor principal; os demais
              assinam como devedores solidários.
            </p>
          </header>
          <div className="space-y-3 px-4 py-3">
            {candidatos.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Nenhum responsável cadastrado no Sponte para os alunos selecionados.
              </div>
            )}
            {candidatos.map((c) => {
              const marcado = marcados.includes(c.chave);
              return (
                <label
                  key={c.chave}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                    marcado ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={marcado}
                    onChange={() =>
                      setMarcados((prev) =>
                        prev.includes(c.chave)
                          ? prev.filter((x) => x !== c.chave)
                          : [...prev, c.chave],
                      )
                    }
                  />
                  <span>
                    <span className="font-medium">{c.responsavel.nome}</span>
                    {c.responsavel.financeiro && (
                      <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                        Responsável financeiro
                      </span>
                    )}
                    {c.alunos.length === 0 && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Devedor solidário
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {[
                        c.responsavel.parentesco,
                        c.responsavel.cpf ? `CPF ${c.responsavel.cpf}` : "",
                        formatarDataBR(c.responsavel.dataNascimento)
                          ? `nasc. ${formatarDataBR(c.responsavel.dataNascimento)}`
                          : "",
                        c.responsavel.telefone,
                        c.responsavel.email,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {c.alunos.length > 1 && (
                      <span className="block text-[11px] text-muted-foreground">
                        Responsável de {c.alunos.join(" e ")}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() =>
                  setManuais((prev) => [...prev, devedorVazio(`manual:${Date.now()}`)])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar devedor solidário (não cadastrado)
              </Button>
              <Button
                variant="outline"
                className="h-8 gap-1 text-xs"
                disabled={!buscaValida || buscarAlunos.isPending}
                onClick={() => {
                  setAlvo("solidario");
                  buscarAlunos.mutate();
                }}
              >
                <Search className="h-3.5 w-3.5" /> Buscar responsável de outro aluno no Sponte
              </Button>
            </div>
            {!buscaValida && (
              <p className="text-[11px] text-muted-foreground">
                Para buscar um responsável de outro aluno, digite o nome ou o AlunoID no campo de
                busca do passo 1.
              </p>
            )}

            {manuais.map((d, i) => (
              <div
                key={d.id}
                className="space-y-2 rounded-lg border border-dashed border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Devedor solidário {i + 1} (cadastro manual)
                  </span>
                  <Button
                    variant="ghost"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setManuais((prev) => prev.filter((x) => x.id !== d.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remover
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {CAMPOS_DEVEDOR_MANUAL.map(({ campo, label, tipo }) => (
                    <div key={campo} className="flex flex-col gap-1">
                      <Label
                        htmlFor={`${d.id}-${campo}`}
                        className="text-[11px] text-muted-foreground"
                      >
                        {label}
                      </Label>
                      <Input
                        id={`${d.id}-${campo}`}
                        type={tipo ?? "text"}
                        value={d[campo]}
                        className="h-9"
                        onChange={(e) =>
                          setManuais((prev) =>
                            prev.map((x) =>
                              x.id === d.id ? { ...x, [campo]: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Passo 3 — dívida, parcelamento e emissão */}
      {alunos.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Scale className="h-4 w-4 text-primary" /> 3. Dívida confessada
            </h2>
            <p className="text-xs text-muted-foreground">
              Cada bloco de parcelamento tem sua própria quantidade de parcelas e valor de parcela,
              para acordos com valores diferentes ao longo do tempo. Vencimento que cai em fim de
              semana ou feriado nacional vai para o próximo dia útil.
            </p>
          </header>
          <div className="space-y-4 px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="termo-ano" className="text-[11px] text-muted-foreground">
                  Ano letivo de referência
                </Label>
                <Input
                  id="termo-ano"
                  inputMode="numeric"
                  value={anoLetivo}
                  className="h-9"
                  onChange={(e) => setAnoLetivo(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="termo-forma" className="text-[11px] text-muted-foreground">
                  Forma de pagamento
                </Label>
                <Input
                  id="termo-forma"
                  value={formaPagamento}
                  className="h-9"
                  onChange={(e) => setFormaPagamento(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="termo-data" className="text-[11px] text-muted-foreground">
                  Data que consta no documento
                </Label>
                <Input
                  id="termo-data"
                  type="date"
                  value={dataDocumento}
                  className="h-9"
                  onChange={(e) => setDataDocumento(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-[11px] text-muted-foreground">Blocos de parcelamento</Label>
              {blocos.map((bloco, i) => (
                <div
                  key={bloco.id}
                  className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                >
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor={`${bloco.id}-qtd`}
                      className="text-[11px] text-muted-foreground"
                    >
                      Bloco {i + 1} — nº de parcelas
                    </Label>
                    <Input
                      id={`${bloco.id}-qtd`}
                      type="number"
                      min={1}
                      max={72}
                      value={String(bloco.quantidade)}
                      className="h-9 w-32"
                      onChange={(e) =>
                        atualizarBloco(bloco.id, {
                          quantidade: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor={`${bloco.id}-valor`}
                      className="text-[11px] text-muted-foreground"
                    >
                      Valor de cada parcela
                    </Label>
                    <Input
                      id={`${bloco.id}-valor`}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={valoresTexto[bloco.id] ?? ""}
                      className="h-9 w-36"
                      onChange={(e) => {
                        const texto = e.target.value;
                        setValoresTexto((prev) => ({ ...prev, [bloco.id]: texto }));
                        const n = parseBRLNumber(texto);
                        atualizarBloco(bloco.id, {
                          valorParcela: Number.isFinite(n) && n > 0 ? n : 0,
                        });
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor={`${bloco.id}-venc`}
                      className="text-[11px] text-muted-foreground"
                    >
                      Vencimento da 1ª parcela do bloco
                    </Label>
                    <Input
                      id={`${bloco.id}-venc`}
                      type="date"
                      value={bloco.primeiroVencimento}
                      className="h-9 w-44"
                      onChange={(e) =>
                        atualizarBloco(bloco.id, { primeiroVencimento: e.target.value })
                      }
                    />
                  </div>
                  {bloco.valorParcela > 0 && bloco.quantidade > 0 && (
                    <div className="pb-2 text-xs text-muted-foreground">
                      = {formatarBRL(bloco.quantidade * bloco.valorParcela)}
                    </div>
                  )}
                  {blocos.length > 1 && (
                    <Button
                      variant="ghost"
                      className="h-9 gap-1 text-xs text-destructive"
                      onClick={() => setBlocos((prev) => prev.filter((b) => b.id !== bloco.id))}
                    >
                      <Trash2 className="h-4 w-4" /> Remover
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" className="h-9 gap-1" onClick={adicionarBloco}>
                <Plus className="h-4 w-4" /> Adicionar bloco de pagamento
              </Button>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">
                Valor total da dívida (calculado)
              </Label>
              <Input readOnly value={formatarBRL(valorTotal)} className="h-9 w-48 bg-muted" />
              {valorTotal > 0 && (
                <p className="text-xs text-muted-foreground">{valorPorExtenso(valorTotal)}</p>
              )}
            </div>

            {parcelas.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parcela</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parcelas.map((p) => (
                      <TableRow key={p.numero}>
                        <TableCell>
                          {p.numero}/{parcelas.length}
                        </TableCell>
                        <TableCell>{formatarDataBR(p.vencimento)}</TableCell>
                        <TableCell className="text-right">{formatarBRL(p.valor)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={2} className="font-medium">
                        Total das parcelas
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatarBRL(totalParcelasTermo(parcelas))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-[11px] text-muted-foreground">
                Testemunhas (aparecem no bloco de assinaturas)
              </Label>
              {testemunhas.map((t, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <Input
                    value={t.nome}
                    placeholder={`Nome da testemunha ${i + 1}`}
                    className="h-9 w-72"
                    onChange={(e) =>
                      setTestemunhas((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)),
                      )
                    }
                  />
                  <Input
                    value={t.cpf}
                    placeholder="CPF"
                    className="h-9 w-44"
                    onChange={(e) =>
                      setTestemunhas((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, cpf: e.target.value } : x)),
                      )
                    }
                  />
                </div>
              ))}
            </div>

            {erros.length > 0 && (
              <ul className="list-inside list-disc rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {erros.map((erro) => (
                  <li key={erro}>{erro}</li>
                ))}
              </ul>
            )}

            <div className="flex justify-end">
              <Button
                className="gap-1"
                disabled={erros.length > 0 || gerar.isPending}
                onClick={() => gerar.mutate()}
              >
                {gerar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Gerar Termo de Confissão (PDF)
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
