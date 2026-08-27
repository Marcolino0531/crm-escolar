// Envio em lote da Declaração de Imposto de Renda.
//
// A prévia é montada em duas etapas porque o Sponte separa as informações: uma
// chamada devolve os alunos ativos da unidade e outra o cadastro do responsável
// financeiro de cada aluno (é lá que está o email), resolvida em fatias para a
// tela mostrar progresso. Cada declaração passa pelo MESMO caminho do documento
// individual (mesmo filtro de pagamentos, mesmo gerador de PDF e mesmo registro
// no histórico); o disparo é sequencial, com pausa entre emails, e o email de
// destino é resolvido no servidor — o cliente não escolhe destinatário.

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, MailX, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { carregarLogoDoColegio, paraColegioRecibo, UNIDADES, useColegios } from "@/lib/colegios";
import { gerarPdfDeclaracaoIR } from "@/lib/declaracao-ir-pdf";
import { pdfParaBase64 } from "@/lib/documento-pdf";
import {
  anoIRPadrao,
  anoReferenciaIR,
  anosIRDisponiveis,
  montarDeclaracaoIR,
  pagamentosIR,
  totalPagamentosIR,
  type ParcelaIR,
} from "@/lib/imposto-renda";
import {
  destinatariosLote,
  emailValido,
  falhasDoLote,
  INTERVALO_ENVIO_MS,
  mesclarResultados,
  resumoEnvio,
  resumoPrevia,
  type AlunoLoteIR,
  type ResultadoEnvioLote,
} from "@/lib/imposto-renda-lote";
import { enviarDeclaracaoIREmail } from "@/lib/imposto-renda-lote.functions";
import type { AlunoRecibo, ColegioRecibo } from "@/lib/recibos";
import {
  buscarResponsaveisFinanceirosLoteIR,
  fetchTitulosAlunoSponte,
  listarAlunosAtivosLoteIR,
} from "@/lib/sponte.functions";

// Fatia da resolução de responsáveis: o mesmo teto validado no server function.
const FATIA_RESPONSAVEIS = 25;

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Documento já persistido no histórico, guardado para o reenvio não emitir a
// declaração de novo: reenviar repete só o email, com o mesmo PDF.
type DocumentoEmitido = {
  numero: number;
  colegio: ColegioRecibo;
  aluno: AlunoRecibo;
  responsavelNome: string;
  responsavelCpf: string;
  parcelas: ParcelaIR[];
  dataDocumento: string;
};

export function EnvioLoteDeclaracaoIR() {
  const { canEdit } = usePermissions();
  const { session } = useAuth();
  const qc = useQueryClient();
  const podeEditar = canEdit("documentos");

  const { data: colegios = [] } = useColegios();
  const listarAlunos = useServerFn(listarAlunosAtivosLoteIR);
  const buscarResponsaveis = useServerFn(buscarResponsaveisFinanceirosLoteIR);
  const buscarTitulos = useServerFn(fetchTitulosAlunoSponte);
  const enviarEmail = useServerFn(enviarDeclaracaoIREmail);

  const hoje = hojeYMD();
  const [unidade, setUnidade] = useState<string>(UNIDADES[0]);
  const [anoIR, setAnoIR] = useState<number>(anoIRPadrao(hoje));
  const [alunos, setAlunos] = useState<AlunoLoteIR[] | null>(null);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [resultados, setResultados] = useState<ResultadoEnvioLote[] | null>(null);
  const [emitidos, setEmitidos] = useState<Record<string, DocumentoEmitido>>({});

  const anos = useMemo(() => anosIRDisponiveis(hoje), [hoje]);
  const colegio = colegios.find((c) => c.unidade === unidade) ?? null;
  const colegioIR = colegio ? paraColegioRecibo(colegio) : null;

  const previa = useMemo(() => resumoPrevia(alunos ?? []), [alunos]);
  const destinatarios = useMemo(() => destinatariosLote(alunos ?? []), [alunos]);
  const resumo = useMemo(() => resumoEnvio(resultados ?? []), [resultados]);
  const falhas = useMemo(() => falhasDoLote(resultados ?? []), [resultados]);

  const limpar = () => {
    setAlunos(null);
    setResultados(null);
    setEmitidos({});
    setProgresso(null);
  };

  const carregarPrevia = useMutation({
    mutationFn: async (): Promise<AlunoLoteIR[]> => {
      const lista = await listarAlunos({ data: { unidade } });
      if (lista.error) throw new Error(lista.error);
      setProgresso({ feitos: 0, total: lista.alunos.length });

      const completos: AlunoLoteIR[] = [];
      for (let i = 0; i < lista.alunos.length; i += FATIA_RESPONSAVEIS) {
        const fatia = lista.alunos.slice(i, i + FATIA_RESPONSAVEIS);
        const r = await buscarResponsaveis({
          data: { unidade, alunoIds: fatia.map((a) => a.alunoId) },
        });
        if (r.error) throw new Error(r.error);
        const porAluno = new Map(r.responsaveis.map((x) => [x.alunoId, x]));
        for (const a of fatia) {
          const resp = porAluno.get(a.alunoId);
          completos.push({
            alunoId: a.alunoId,
            nome: a.nome,
            turma: a.turma,
            responsavelId: resp?.responsavelId ?? "",
            responsavelNome: resp?.responsavelNome ?? "",
            responsavelCpf: resp?.responsavelCpf ?? "",
            responsavelEmail: resp?.responsavelEmail ?? "",
          });
        }
        setProgresso({
          feitos: Math.min(i + FATIA_RESPONSAVEIS, lista.alunos.length),
          total: lista.alunos.length,
        });
      }
      return completos;
    },
    onSuccess: (lista) => {
      setAlunos(lista);
      setResultados(null);
      setEmitidos({});
      setProgresso(null);
      if (lista.length === 0) toast.error(`Nenhum aluno ativo encontrado em ${unidade}.`);
    },
    onError: (e) => {
      setProgresso(null);
      setAlunos(null);
      toast.error(e instanceof Error ? e.message : "Falha ao montar a prévia.");
    },
  });

  // Emite (histórico + PDF) e envia UM aluno. Reusa o documento já emitido
  // quando é reenvio, para não duplicar o registro no histórico.
  const processarAluno = async (
    aluno: AlunoLoteIR,
    logo: Awaited<ReturnType<typeof carregarLogoDoColegio>>,
  ): Promise<{ resultado: ResultadoEnvioLote; emitido?: DocumentoEmitido }> => {
    const base: ResultadoEnvioLote = {
      alunoId: aluno.alunoId,
      alunoNome: aluno.nome,
      email: aluno.responsavelEmail,
      ok: false,
    };
    if (!colegio || !colegioIR) return { resultado: { ...base, erro: "Colégio sem cadastro." } };

    try {
      let emitido = emitidos[aluno.alunoId];
      if (!emitido) {
        const titulos = await buscarTitulos({ data: { alunoId: aluno.alunoId, unidade } });
        if (titulos.error) throw new Error(titulos.error);
        if (titulos.indisponivel) throw new Error("Integração Sponte indisponível.");

        const parcelas: ParcelaIR[] = titulos.titulos.map((t) => ({
          categoria: t.categoria,
          numeroParcela: t.numeroParcela,
          valorPago: t.valorPago,
          dataPagamento: t.dataPagamento,
        }));
        const pagamentos = pagamentosIR(parcelas, anoIR);
        if (pagamentos.length === 0) {
          return {
            resultado: {
              ...base,
              erro: `Sem pagamentos de Matrícula/Mensalidade em ${anoReferenciaIR(anoIR)}.`,
            },
          };
        }

        const alunoDoc: AlunoRecibo = {
          alunoId: aluno.alunoId,
          nome: aluno.nome,
          cpf: "",
          turma: aluno.turma,
          matricula: "",
        };
        const snapshot = {
          colegio: colegioIR,
          aluno: alunoDoc,
          responsavelNome: aluno.responsavelNome,
          responsavelCpf: aluno.responsavelCpf,
          anoIR,
          parcelas: pagamentos.map((p) => ({
            categoria: p.categoria,
            numeroParcela: p.parcela,
            valorPago: p.valor,
            dataPagamento: p.dataPagamento,
          })),
        };
        const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
        const { data, error } = await supabase
          .from("documentos_recibos" as never)
          .insert({
            tipo: "declaracao_ir",
            unidade,
            aluno_id: aluno.alunoId,
            aluno_nome: aluno.nome,
            responsavel_id: aluno.responsavelId,
            responsavel_nome: aluno.responsavelNome,
            responsavel_cpf: aluno.responsavelCpf,
            data_recibo: hoje,
            valor_total: totalPagamentosIR(pagamentos),
            itens: [],
            snapshot,
            created_by: session?.user?.id ?? null,
            created_by_nome: meta?.full_name || session?.user?.email || "",
          } as never)
          .select("numero")
          .single();
        if (error) throw new Error(error.message);

        emitido = {
          numero: Number((data as unknown as { numero: number }).numero),
          colegio: colegioIR,
          aluno: alunoDoc,
          responsavelNome: snapshot.responsavelNome,
          responsavelCpf: snapshot.responsavelCpf,
          parcelas: snapshot.parcelas,
          dataDocumento: hoje,
        };
      }

      const documento = montarDeclaracaoIR({
        numero: emitido.numero,
        anoIR,
        dataDocumento: emitido.dataDocumento,
        colegio: emitido.colegio,
        aluno: emitido.aluno,
        responsavelNome: emitido.responsavelNome,
        responsavelCpf: emitido.responsavelCpf,
        parcelas: emitido.parcelas,
      });
      const pdf = await gerarPdfDeclaracaoIR(documento, logo);
      const envio = await enviarEmail({
        data: {
          unidade,
          alunoId: aluno.alunoId,
          alunoNome: aluno.nome,
          anoIR,
          nomeColegio: colegioIR.unidade,
          pdfBase64: pdfParaBase64(pdf),
        },
      });
      return {
        resultado: {
          ...base,
          email: envio.email || aluno.responsavelEmail,
          ok: envio.ok,
          erro: envio.error,
        },
        emitido,
      };
    } catch (e) {
      return { resultado: { ...base, erro: e instanceof Error ? e.message : "Falha no envio." } };
    }
  };

  // Percorre os alunos um a um, com pausa entre emails: uma falha não
  // interrompe o lote, ela só vira linha no resumo.
  const processarFila = async (fila: AlunoLoteIR[]): Promise<ResultadoEnvioLote[]> => {
    const logo = colegio ? await carregarLogoDoColegio(colegio.logo_path) : null;
    const saida: ResultadoEnvioLote[] = [];
    setProgresso({ feitos: 0, total: fila.length });
    for (const [i, aluno] of fila.entries()) {
      const { resultado, emitido } = await processarAluno(aluno, logo);
      saida.push(resultado);
      if (emitido) setEmitidos((prev) => ({ ...prev, [aluno.alunoId]: emitido }));
      setProgresso({ feitos: i + 1, total: fila.length });
      if (i < fila.length - 1) await esperar(INTERVALO_ENVIO_MS);
    }
    return saida;
  };

  const enviarLote = useMutation({
    mutationFn: () => processarFila(destinatarios),
    onSuccess: (saida) => {
      setResultados(saida);
      setProgresso(null);
      const r = resumoEnvio(saida);
      if (r.falhas === 0) toast.success(`${r.enviados} declarações enviadas.`);
      else toast.error(`${r.enviados} enviadas, ${r.falhas} com falha.`);
      qc.invalidateQueries({ queryKey: ["documentos_recibos"] });
    },
    onError: (e) => {
      setProgresso(null);
      toast.error(e instanceof Error ? e.message : "Falha no envio em lote.");
    },
  });

  const reenviarFalhas = useMutation({
    mutationFn: async () => {
      const porAluno = new Map((alunos ?? []).map((a) => [a.alunoId, a]));
      const fila = falhas
        .map((f) => porAluno.get(f.alunoId))
        .filter((a): a is AlunoLoteIR => !!a && emailValido(a.responsavelEmail));
      return processarFila(fila);
    },
    onSuccess: (saida) => {
      setResultados((prev) => mesclarResultados(prev ?? [], saida));
      setProgresso(null);
      const r = resumoEnvio(saida);
      if (r.falhas === 0) toast.success(`${r.enviados} reenviadas com sucesso.`);
      else toast.error(`Reenvio: ${r.enviados} ok, ${r.falhas} ainda com falha.`);
      qc.invalidateQueries({ queryKey: ["documentos_recibos"] });
    },
    onError: (e) => {
      setProgresso(null);
      toast.error(e instanceof Error ? e.message : "Falha no reenvio.");
    },
  });

  const ocupado = carregarPrevia.isPending || enviarLote.isPending || reenviarFalhas.isPending;

  if (!podeEditar) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Você tem acesso somente de leitura em Documentos: o envio em lote exige permissão de edição.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Passo 1 — filtros */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Search className="h-4 w-4 text-primary" /> 1. Colégio e ano
          </h2>
          <p className="text-xs text-muted-foreground">
            A declaração é gerada para todos os alunos ativos da unidade, com os mesmos filtros do
            documento individual (Matrícula e Mensalidade pagas no ano-calendário).
          </p>
        </header>
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">Colégio</Label>
            <Select
              value={unidade}
              onValueChange={(v) => {
                setUnidade(v);
                limpar();
              }}
              disabled={ocupado}
            >
              <SelectTrigger className="h-9 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIDADES.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">Ano do Imposto de Renda</Label>
            <Select
              value={String(anoIR)}
              onValueChange={(v) => {
                setAnoIR(Number(v));
                limpar();
              }}
              disabled={ocupado}
            >
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anos.map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    IR {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            className="h-9 gap-1"
            disabled={ocupado}
            onClick={() => carregarPrevia.mutate()}
          >
            {carregarPrevia.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Buscar alunos ativos
          </Button>
          <span className="text-xs text-muted-foreground">
            Pagamentos do ano-calendário {anoReferenciaIR(anoIR)}.
          </span>
        </div>
        {carregarPrevia.isPending && progresso && (
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Buscando responsáveis no Sponte… {progresso.feitos}/{progresso.total}
          </div>
        )}
      </section>

      {!colegio && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {unidade} ainda não tem cadastro em Configurações → Dados dos Colégios. Preencha razão
            social, CNPJ e endereço antes de emitir.
          </span>
        </div>
      )}

      {/* Passo 2 — prévia */}
      {alunos && alunos.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">2. Prévia</h2>
              <p className="text-xs text-muted-foreground">
                {previa.total} alunos encontrados, {previa.comEmail} com email cadastrado,{" "}
                {previa.semEmail} sem email
              </p>
            </div>
            <Button
              className="h-9 gap-1"
              disabled={ocupado || !colegio || destinatarios.length === 0}
              onClick={() => enviarLote.mutate()}
            >
              {enviarLote.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Confirmar envio para {destinatarios.length} responsáveis
            </Button>
          </header>
          {enviarLote.isPending && progresso && (
            <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
              Enviando… {progresso.feitos}/{progresso.total}
            </div>
          )}
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Responsável financeiro</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alunos.map((a) => {
                  const temEmail = emailValido(a.responsavelEmail);
                  return (
                    <TableRow
                      key={a.alunoId}
                      className={temEmail ? "" : "bg-amber-50/60 dark:bg-amber-950/20"}
                    >
                      <TableCell className="text-sm">
                        {a.nome}
                        <span className="ml-2 text-[11px] text-muted-foreground">{a.turma}</span>
                      </TableCell>
                      <TableCell className="text-sm">{a.responsavelNome || "—"}</TableCell>
                      <TableCell className="text-sm">
                        {temEmail ? (
                          a.responsavelEmail
                        ) : (
                          <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <MailX className="h-3.5 w-3.5" /> sem email — avisar por outro meio
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Passo 3 — resumo do envio */}
      {resultados && resultados.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">3. Resumo do envio</h2>
              <p className="text-xs text-muted-foreground">
                {resumo.enviados} enviados com sucesso, {resumo.falhas} com falha
              </p>
            </div>
            {falhas.length > 0 && (
              <Button
                variant="outline"
                className="h-9 gap-1"
                disabled={ocupado}
                onClick={() => reenviarFalhas.mutate()}
              >
                {reenviarFalhas.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Reenviar {falhas.length} que falharam
              </Button>
            )}
          </header>
          {reenviarFalhas.isPending && progresso && (
            <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
              Reenviando… {progresso.feitos}/{progresso.total}
            </div>
          )}
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultados.map((r) => (
                  <TableRow key={r.alunoId}>
                    <TableCell className="text-sm">{r.alunoNome}</TableCell>
                    <TableCell className="text-sm">{r.email || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {r.ok ? (
                        <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" /> enviado
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" /> {r.erro || "falha no envio"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}
