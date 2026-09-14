import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { avisarExtrasContrato } from "@/lib/contrato-avisos-toast";
import { FileText, Loader2, Search, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelecioneUnidade, useUnidadeAtiva } from "@/components/SelecioneUnidade";
import { Signatarios } from "@/components/rematricula/ContratosMatricula";
import { abrirPdfBase64 } from "@/lib/abrir-pdf";
import { usePermissions } from "@/lib/app-context";
import { formatarBRL, formatarDataBR } from "@/lib/recibos";
import { resolverMatriculaInformada } from "@/lib/contrato-matricula";
import {
  dadosContratoDocumentos,
  gerarEnviarContratoMatricula,
  previaContratoMatricula,
} from "@/lib/contrato-matricula.functions";
import { buscarAlunosSponte, type AlunoBuscaSponte } from "@/lib/sponte.functions";

const ANO_ATUAL = new Date().getFullYear();
const ANOS_LETIVOS = [ANO_ATUAL, ANO_ATUAL + 1];

// Contrato de Matrícula gerado fora do portal de rematrícula (matrícula nova):
// aluno e ano letivo escolhidos aqui; Série, Mensalidade e Extras vêm do Sponte;
// a Matrícula é a tabela do ano (segmento da série) ou um valor manual, com
// parcelas e 1º vencimento digitados. Envio real na ZapSign de produção pela
// mesma função da Rematrícula.
export function GerarContratoMatricula() {
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("documentos") || canEdit("rematricula");
  const unidade = useUnidadeAtiva() ?? "";
  const buscar = useServerFn(buscarAlunosSponte);
  const carregarDados = useServerFn(dadosContratoDocumentos);
  const previa = useServerFn(previaContratoMatricula);
  const gerar = useServerFn(gerarEnviarContratoMatricula);

  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [aluno, setAluno] = useState<AlunoBuscaSponte | null>(null);
  const [anoLetivo, setAnoLetivo] = useState<number>(ANO_ATUAL + 1);
  const [valorManual, setValorManual] = useState("");
  const [parcelas, setParcelas] = useState("1");
  const [primeiroVencimento, setPrimeiroVencimento] = useState("");

  useEffect(() => {
    setResultados(null);
    setAluno(null);
  }, [unidade]);

  const dados = useQuery({
    queryKey: ["contrato-documentos", unidade, aluno?.alunoId, anoLetivo],
    queryFn: () => carregarDados({ data: { unidade, alunoId: aluno!.alunoId, anoLetivo } }),
    enabled: Boolean(unidade && aluno),
  });

  const buscarAlunos = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: termo.trim(), unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      return r.alunos;
    },
    onSuccess: setResultados,
    onError: (e) => {
      setResultados(null);
      toast.error(e instanceof Error ? e.message : "Falha na busca.");
    },
  });

  const resolvida = useMemo(
    () =>
      resolverMatriculaInformada({
        valorTabela: dados.data?.ok ? dados.data.valorTabela : null,
        valorManual,
        parcelas,
        primeiroVencimento,
      }),
    [dados.data, valorManual, parcelas, primeiroVencimento],
  );

  const entrada = () =>
    aluno && resolvida.matricula
      ? { unidade, alunoId: aluno.alunoId, anoLetivo, matricula: resolvida.matricula }
      : null;

  const gerarPrevia = useMutation({
    mutationFn: async () => {
      const data = entrada();
      if (!data) throw new Error("Preencha os dados da Matrícula.");
      const r = await previa({ data });
      if (!r.ok || !r.pdfBase64) throw new Error(r.erro ?? "Falha ao gerar a prévia.");
      abrirPdfBase64(r.pdfBase64, r.nomeArquivo ?? "previa-contrato.pdf");
      avisarExtrasContrato(r.avisos);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao gerar a prévia."),
  });

  const gerarEnviar = useMutation({
    mutationFn: async () => {
      const data = entrada();
      if (!data) throw new Error("Preencha os dados da Matrícula.");
      const r = await gerar({ data });
      if (!r.ok) throw new Error(r.erro ?? "Falha ao gerar o contrato.");
      return r;
    },
    onSuccess: (r) => {
      toast.success(`Contrato ${r.numero} enviado para assinatura na ZapSign.`);
      avisarExtrasContrato(r.avisos);
      dados.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao gerar o contrato."),
  });

  const t = termo.trim();
  const termoValido = /^\d+$/.test(t) ? t.length >= 1 : t.length >= 3;

  if (!podeEditar) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Gerar o Contrato de Matrícula exige permissão de edição em Documentos ou em Rematrícula.
      </div>
    );
  }
  if (!unidade) return <SelecioneUnidade acao="A geração do contrato" />;

  const info = dados.data?.ok ? dados.data : null;
  const contratoEnviado = info?.contrato?.status === "enviado";
  const ocupado = gerarPrevia.isPending || gerarEnviar.isPending;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Search className="h-4 w-4 text-primary" /> 1. Aluno e ano letivo
          </h2>
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
              <Label className="text-[11px] text-muted-foreground">Ano letivo</Label>
              <Select value={String(anoLetivo)} onValueChange={(v) => setAnoLetivo(Number(v))}>
                <SelectTrigger className="h-9 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANOS_LETIVOS.map((a) => (
                    <SelectItem key={a} value={String(a)}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="contrato-busca" className="text-[11px] text-muted-foreground">
                Aluno (nome ou AlunoID do Sponte)
              </Label>
              <Input
                id="contrato-busca"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && termoValido) buscarAlunos.mutate();
                }}
                className="h-9 w-64"
              />
            </div>
            <Button
              variant="outline"
              className="h-9 gap-1"
              disabled={!termoValido || buscarAlunos.isPending}
              onClick={() => buscarAlunos.mutate()}
            >
              {buscarAlunos.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Buscar no Sponte
            </Button>
          </div>

          {resultados && resultados.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Nenhum aluno encontrado para “{t}” em {unidade}.
            </div>
          )}
          {resultados && resultados.length > 0 && (
            <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {resultados.map((a) => (
                <button
                  key={a.alunoId}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setAluno(a);
                    setResultados(null);
                    setTermo("");
                  }}
                >
                  <span>
                    <span className="font-medium">{a.nome}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      #{a.alunoId} · {a.turma || "sem turma"} · {a.situacao}
                    </span>
                  </span>
                  <User className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {aluno && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {aluno.nome}{" "}
                  <span className="text-xs text-muted-foreground">#{aluno.alunoId}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {dados.isPending
                    ? "Lendo série no Sponte…"
                    : info
                      ? `Série: ${info.serie || "não identificada"} · ${aluno.turma || "sem turma"}`
                      : (dados.data?.erro ?? "")}
                </div>
              </div>
              <Button variant="ghost" className="h-8 text-xs" onClick={() => setAluno(null)}>
                Trocar aluno
              </Button>
            </div>
          )}
        </div>
      </section>

      {aluno && info && (
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FileText className="h-4 w-4 text-primary" /> 2. Matrícula {anoLetivo}
            </h2>
          </header>
          <div className="space-y-3 px-4 py-3 text-sm">
            {info.matriculaRematricula && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Este aluno já finalizou a rematrícula de {anoLetivo} no portal (Matrícula{" "}
                {formatarBRL(info.matriculaRematricula.valor)} em{" "}
                {info.matriculaRematricula.parcelas}
                x, 1º vencimento {formatarDataBR(info.matriculaRematricula.primeiroVencimento)}). O
                caminho normal é a aba Contratos da Rematrícula; aqui os valores digitados abaixo
                substituem os do portal.
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-muted-foreground">
                  Valor integral (tabela {anoLetivo})
                </Label>
                <div className="flex h-9 w-44 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
                  {info.valorTabela !== null ? formatarBRL(info.valorTabela) : "—"}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor="contrato-valor-manual"
                  className="text-[11px] text-muted-foreground"
                >
                  Valor manual (bolsa/negociação)
                </Label>
                <Input
                  id="contrato-valor-manual"
                  value={valorManual}
                  onChange={(e) => setValorManual(e.target.value)}
                  placeholder={info.valorTabela !== null ? "vazio = tabela" : "ex.: 1.200,00"}
                  className="h-9 w-44"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="contrato-parcelas" className="text-[11px] text-muted-foreground">
                  Parcelas
                </Label>
                <Input
                  id="contrato-parcelas"
                  type="number"
                  min={1}
                  max={12}
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                  className="h-9 w-24"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="contrato-venc" className="text-[11px] text-muted-foreground">
                  1º vencimento
                </Label>
                <Input
                  id="contrato-venc"
                  type="date"
                  value={primeiroVencimento}
                  onChange={(e) => setPrimeiroVencimento(e.target.value)}
                  className="h-9 w-44"
                />
              </div>
            </div>
            {!info.tabelaConfigurada && (
              <div className="text-xs text-muted-foreground">
                Não há tabela de valores de Matrícula configurada para {anoLetivo}: informe o valor
                manualmente.
              </div>
            )}
            {info.tabelaConfigurada && info.valorTabela === null && (
              <div className="text-xs text-muted-foreground">
                A série do aluno não tem valor cadastrado para {anoLetivo}: informe o valor
                manualmente.
              </div>
            )}
            {resolvida.matricula && (
              <div className="text-xs text-muted-foreground">
                Contrato sairá com Matrícula {formatarBRL(resolvida.matricula.valor)} (
                {resolvida.origem === "manual" ? "valor manual" : "valor da tabela"}) em{" "}
                {resolvida.matricula.parcelas}x, 1º vencimento{" "}
                {formatarDataBR(resolvida.matricula.primeiroVencimento)}. Série, mensalidade e
                extras vêm do Sponte.
              </div>
            )}
            {resolvida.erros.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-destructive">
                {resolvida.erros.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            {info.contrato && (
              <div className="space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                <div>
                  Contrato {info.contrato.numero} — status <b>{info.contrato.status}</b>
                  {info.contrato.enviadoEm
                    ? ` · enviado em ${formatarDataBR(info.contrato.enviadoEm.slice(0, 10))}`
                    : ""}
                </div>
                <Signatarios signatarios={info.contrato.signatarios} />
                {contratoEnviado && (
                  <div className="text-muted-foreground">
                    Para gerar outro, cancele este contrato na aba Contratos da Rematrícula.
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                className="gap-1"
                disabled={!resolvida.matricula || ocupado}
                onClick={() => gerarPrevia.mutate()}
              >
                {gerarPrevia.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Gerar prévia (PDF)
              </Button>
              <Button
                className="gap-1"
                disabled={!resolvida.matricula || ocupado || contratoEnviado}
                onClick={() => {
                  if (
                    window.confirm(`Enviar o contrato de ${aluno.nome} para assinatura na ZapSign?`)
                  )
                    gerarEnviar.mutate();
                }}
              >
                {gerarEnviar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Gerar e enviar para assinatura
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
