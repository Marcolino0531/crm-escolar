// Aba "Contracheques" do RH: sobe o PDF único da contabilidade, confere página
// a página o funcionário identificado e só então dispara os emails, cada um com
// a sua página recortada e protegida por senha.

import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Funcionario } from "@/lib/crm/types";
import {
  DIGITOS_SENHA_CPF,
  LABEL_STATUS,
  competenciaExtenso,
  conferirPaginas,
  corrigirVinculo,
  paginasEnviaveis,
  removerPagina,
  resumirConferencia,
  senhaDoCpf,
  type FuncionarioContracheque,
  type PaginaContracheque,
} from "@/lib/contracheques";
import {
  ErroLeituraPdf,
  extrairPaginasPdf,
  paraBase64,
  recortarPaginaProtegida,
} from "@/lib/contracheques.pdf";
import { enviarContracheque } from "@/lib/contracheques.functions";

type EnvioRow = {
  id: string;
  employee_nome: string;
  email: string;
  competencia: string;
  pagina: number;
  status: string;
  erro: string | null;
  enviado_em: string;
  enviado_por_nome: string;
};

function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function paraContracheque(f: Funcionario): FuncionarioContracheque {
  return {
    id: f.id,
    nomeCompleto: f.nomeCompleto,
    cpf: f.cpf ?? "",
    email: f.email ?? "",
    unidade: f.unidade,
    ativo: !f.dataRescisao,
  };
}

const CORES_STATUS: Record<PaginaContracheque["status"], string> = {
  pronta: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sem_correspondencia: "bg-red-50 text-red-700 border-red-200",
  sem_email: "bg-amber-50 text-amber-700 border-amber-200",
  sem_cpf: "bg-amber-50 text-amber-700 border-amber-200",
};

const Contracheques: React.FC<{ funcionarios: Funcionario[]; isAdmin: boolean }> = ({
  funcionarios,
  isAdmin,
}) => {
  const qc = useQueryClient();
  const enviarFn = useServerFn(enviarContracheque);

  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [paginas, setPaginas] = useState<PaginaContracheque[] | null>(null);
  const [lendo, setLendo] = useState(false);
  // PDF da contabilidade que vem cifrado: guardamos a senha de abertura para
  // reabrir o arquivo no recorte de cada página.
  const [senhaPdf, setSenhaPdf] = useState("");
  const [pedeSenha, setPedeSenha] = useState(false);
  const [protegido, setProtegido] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState<{ feitos: number; total: number } | null>(null);

  const elenco = useMemo(() => funcionarios.map(paraContracheque), [funcionarios]);
  const porId = useMemo(() => new Map(elenco.map((f) => [f.id, f])), [elenco]);
  const resumo = paginas ? resumirConferencia(paginas) : null;
  const enviaveis = paginas ? paginasEnviaveis(paginas) : [];

  const historico = useQuery({
    queryKey: ["hr-payslip-sends"],
    queryFn: async (): Promise<EnvioRow[]> => {
      const { data, error } = await supabase
        .from("hr_payslip_sends" as never)
        .select(
          "id, employee_nome, email, competencia, pagina, status, erro, enviado_em, enviado_por_nome",
        )
        .order("enviado_em", { ascending: false })
        .limit(300);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as EnvioRow[];
    },
  });

  // Leitura do PDF. `senha` só é usada quando o arquivo da contabilidade vem
  // cifrado — o motivo real de cada falha é mostrado ao usuário, em vez de um
  // erro genérico, porque a ação de correção é diferente em cada caso.
  const processarArquivo = async (file: File, senha: string) => {
    setLendo(true);
    setPaginas(null);
    setFalha(null);
    try {
      const { paginas: extraidas, paginasSemTexto } = await extrairPaginasPdf(
        file,
        senha || undefined,
      );
      setArquivo(file);
      setProtegido(Boolean(senha));
      setPedeSenha(false);
      setPaginas(conferirPaginas(extraidas, elenco));
      if (paginasSemTexto.length > 0) {
        toast.warning(
          `${paginasSemTexto.length} página(s) sem texto legível (${paginasSemTexto.join(", ")}): ` +
            "vincule o funcionário manualmente ou remova a página.",
        );
      }
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : "Não foi possível ler o PDF.";
      const precisaSenha =
        err instanceof ErroLeituraPdf &&
        (err.motivo === "senha" || err.motivo === "senha_incorreta");
      setFalha(mensagem);
      toast.error(mensagem);
      // Com senha pendente o arquivo continua carregado: o usuário digita a
      // senha e tenta de novo sem reescolher o PDF.
      setPedeSenha(precisaSenha);
      setArquivo(precisaSenha ? file : null);
      if (!precisaSenha) setProtegido(false);
    } finally {
      setLendo(false);
    }
  };

  const handleArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Envie o arquivo em PDF.");
      return;
    }
    setSenhaPdf("");
    await processarArquivo(file, "");
  };

  const limpar = () => {
    setArquivo(null);
    setPaginas(null);
    setSenhaPdf("");
    setPedeSenha(false);
    setProtegido(false);
    setFalha(null);
    setExpandida(null);
    setEnviando(null);
  };

  const enviarTodos = async () => {
    setConfirmando(false);
    if (!arquivo || enviaveis.length === 0) return;

    setEnviando({ feitos: 0, total: enviaveis.length });
    let sucessos = 0;
    const falhas: string[] = [];

    for (const [indice, pagina] of enviaveis.entries()) {
      const senha = senhaDoCpf(pagina.cpf);
      if (!pagina.funcionarioId || !senha) {
        falhas.push(pagina.funcionarioNome || `página ${pagina.pagina}`);
        continue;
      }
      try {
        const recorte = await recortarPaginaProtegida(
          arquivo,
          pagina.pagina,
          senha,
          protegido ? senhaPdf : undefined,
        );
        const res = await enviarFn({
          data: {
            employeeId: pagina.funcionarioId,
            competencia,
            pagina: pagina.pagina,
            pdfBase64: paraBase64(recorte),
          },
        });
        if (res.ok) sucessos += 1;
        else falhas.push(`${pagina.funcionarioNome}: ${res.error ?? "falha no envio"}`);
      } catch (err) {
        falhas.push(`${pagina.funcionarioNome}: ${err instanceof Error ? err.message : "erro"}`);
      }
      setEnviando({ feitos: indice + 1, total: enviaveis.length });
    }

    setEnviando(null);
    void qc.invalidateQueries({ queryKey: ["hr-payslip-sends"] });
    if (sucessos > 0) toast.success(`${sucessos} contracheque(s) enviado(s).`);
    if (falhas.length > 0) toast.error(`${falhas.length} envio(s) com falha. Veja o histórico.`);
    if (falhas.length === 0) limpar();
  };

  const inputClass =
    "px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500";

  return (
    <div className="space-y-8">
      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-gray-800">Envio de contracheques</h3>
        <p className="text-sm text-gray-500 mt-1">
          Suba o PDF único da contabilidade (uma página por funcionário). Nada é enviado antes da
          sua confirmação na conferência.
        </p>

        <div className="flex flex-wrap items-end gap-4 mt-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Competência</label>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value || competenciaAtual())}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              PDF de contracheques
            </label>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleArquivo}
              disabled={!isAdmin || lendo || enviando !== null}
              className="block text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 disabled:opacity-50"
            />
          </div>
          {arquivo && (
            <button
              type="button"
              onClick={limpar}
              disabled={enviando !== null}
              className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Descartar arquivo
            </button>
          )}
        </div>

        {!isAdmin && (
          <p className="text-sm text-amber-700 mt-3">
            Você tem acesso somente de leitura ao RH: o envio é feito por quem tem permissão de
            edição.
          </p>
        )}
        {pedeSenha && arquivo && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border border-amber-200 bg-amber-50 rounded-xl p-3">
            <div>
              <label className="block text-xs font-medium text-amber-800 mb-1">
                Senha do PDF ({arquivo.name})
              </label>
              <input
                type="password"
                value={senhaPdf}
                onChange={(e) => setSenhaPdf(e.target.value)}
                placeholder="Senha de abertura do arquivo"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => void processarArquivo(arquivo, senhaPdf)}
              disabled={!senhaPdf.trim() || lendo}
              className="px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              Abrir PDF
            </button>
          </div>
        )}
        {falha && !lendo && <p className="text-sm text-red-600 mt-3">{falha}</p>}
        {lendo && <p className="text-sm text-gray-500 mt-3">Lendo o PDF…</p>}
      </section>

      {paginas && resumo && (
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-800">
                Conferência — {competenciaExtenso(competencia)}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {resumo.total} página(s) · {resumo.prontas} pronta(s) para envio ·{" "}
                {resumo.semCorrespondencia} sem correspondência · {resumo.semEmail} sem email ·{" "}
                {resumo.semCpf} sem CPF
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              disabled={!isAdmin || enviaveis.length === 0 || enviando !== null}
              className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-sm font-medium shadow-md disabled:opacity-50"
            >
              {enviando
                ? `Enviando ${enviando.feitos}/${enviando.total}…`
                : `Enviar ${enviaveis.length} contracheque(s)`}
            </button>
          </div>

          {(resumo.semCorrespondencia > 0 || resumo.semEmail > 0 || resumo.semCpf > 0) && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-4">
              Páginas sinalizadas ficam de fora do envio automático. Corrija o vínculo, complete o
              cadastro do funcionário (email/CPF) ou remova a página e envie o restante.
            </p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3">Pág.</th>
                  <th className="py-2 pr-3">Funcionário identificado</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Situação</th>
                  <th className="py-2 pr-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginas.map((p) => (
                  <React.Fragment key={p.pagina}>
                    <tr className="border-b border-gray-100">
                      <td className="py-2 pr-3 text-gray-700">{p.pagina}</td>
                      <td className="py-2 pr-3">
                        <select
                          value={p.funcionarioId ?? ""}
                          onChange={(e) =>
                            setPaginas((atual) =>
                              atual
                                ? corrigirVinculo(
                                    atual,
                                    p.pagina,
                                    porId.get(e.target.value) ?? null,
                                  )
                                : atual,
                            )
                          }
                          disabled={!isAdmin || enviando !== null}
                          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm max-w-[260px]"
                        >
                          <option value="">— sem correspondência —</option>
                          {elenco.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.nomeCompleto}
                              {f.ativo ? "" : " (desligado)"}
                            </option>
                          ))}
                        </select>
                        {p.origem === "parcial" && (
                          <span className="ml-2 text-xs text-gray-500">nome aproximado</span>
                        )}
                        {p.duplicada && (
                          <span className="ml-2 text-xs text-red-600">
                            funcionário repetido em outra página
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-600">{p.email || "—"}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full border text-xs ${CORES_STATUS[p.status]}`}
                        >
                          {LABEL_STATUS[p.status]}
                        </span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setExpandida(expandida === p.pagina ? null : p.pagina)}
                          className="text-emerald-700 hover:underline mr-3"
                        >
                          {expandida === p.pagina ? "Ocultar texto" : "Ver texto"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPaginas((atual) => (atual ? removerPagina(atual, p.pagina) : atual))
                          }
                          disabled={!isAdmin || enviando !== null}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                    {expandida === p.pagina && (
                      <tr className="bg-gray-50">
                        <td colSpan={5} className="py-3 px-3">
                          <pre className="whitespace-pre-wrap text-xs text-gray-600 max-h-64 overflow-y-auto">
                            {p.texto || "(página sem texto extraível)"}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-gray-800">Histórico de envios</h3>
        {historico.isLoading ? (
          <p className="text-sm text-gray-500 mt-2">Carregando…</p>
        ) : (historico.data ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 mt-2">Nenhum contracheque enviado ainda.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Funcionário</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Competência</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Enviado por</th>
                </tr>
              </thead>
              <tbody>
                {(historico.data ?? []).map((e) => (
                  <tr key={e.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">
                      {new Date(e.enviado_em).toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2 pr-3 text-gray-700">{e.employee_nome}</td>
                    <td className="py-2 pr-3 text-gray-600">{e.email}</td>
                    <td className="py-2 pr-3 text-gray-600">{competenciaExtenso(e.competencia)}</td>
                    <td className="py-2 pr-3">
                      {e.status === "enviado" ? (
                        <span className="inline-block px-2 py-0.5 rounded-full border text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                          Enviado
                        </span>
                      ) : (
                        <span
                          title={e.erro ?? ""}
                          className="inline-block px-2 py-0.5 rounded-full border text-xs bg-red-50 text-red-700 border-red-200"
                        >
                          Falha
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{e.enviado_por_nome || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmando && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-800">Confirmar envio</h3>
            <p className="text-sm text-gray-600 mt-2">
              Serão enviados <strong>{enviaveis.length}</strong> contracheque(s) de{" "}
              {competenciaExtenso(competencia)}, cada um com a sua página em anexo, protegida pelos{" "}
              {DIGITOS_SENHA_CPF} primeiros dígitos do CPF do funcionário.
            </p>
            <ul className="text-sm text-gray-600 mt-3 max-h-52 overflow-y-auto list-disc pl-5">
              {enviaveis.map((p) => (
                <li key={p.pagina}>
                  Pág. {p.pagina} — {p.funcionarioNome} ({p.email})
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-3 mt-5">
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void enviarTodos()}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
              >
                Enviar agora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Contracheques;
