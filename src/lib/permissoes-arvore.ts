// Cadastro ÚNICO de Grupo > Módulo > Página > Subpágina do School Hub.
//
// É a fonte da verdade de nome, ordem e visibilidade usada ao mesmo tempo por:
//   • menu lateral (src/routes/__root.tsx);
//   • abas e sub-abas de cada página (abasVisiveis);
//   • tela Configurações > Gerenciar Acessos (árvore de Visualizar/Editar);
//   • checagens de acesso no cliente (usePermissions) e no servidor
//     (can_view_pagina / can_edit_pagina e políticas RLS).
//
// Regras:
//   • A chave de cada nó é estável: NÃO muda quando o nome exibido muda. Os
//     módulos têm chave própria (ex.: "matricula") e as páginas usam a chave do
//     pai como prefixo (ex.: "matricula.contratos", "rh.pagamentos.salario").
//     Como user_permissions.module é o enum public.app_module, toda chave nova
//     precisa constar de uma migration (ALTER TYPE ... ADD VALUE) — ver a skill
//     .agents/skills/permissoes-arvore-crm-escolar/SKILL.md.
//   • A permissão é gravada SOMENTE nas FOLHAS (página sem filhos ou módulo sem
//     página) — CHAVES_PERMISSAO_GRAVAVEIS. Linhas de user_permissions com
//     qualquer outra chave (chave antiga da lista plana ou nó não-folha) são
//     ignoradas por todas as checagens (TS e SQL). Um nó pai é visível quando
//     alguma folha abaixo dele é visível; é editável quando alguma folha abaixo
//     dele é editável. Editar implica Visualizar.
//   • `legado` descreve de quais chaves antigas (app_module da lista plana) o
//     acesso de cada folha é copiado na migration de correspondência. É uma
//     forma normal disjuntiva: OR entre os grupos, AND dentro do grupo. O
//     caminho inverso (folhasEquivalentes) diz quais folhas reproduzem uma
//     checagem antiga — é o que as policies/server functions usam para que
//     ninguém ganhe nem perca acesso na troca.
//   • `menu` (opcional, em módulos) reproduz a condição antiga do menu quando
//     ela não é "alguma folha visível" (ex.: RH ignora Salário; grupo
//     Financeiro exige o guarda-chuva, a folha financeiro.dados).
//
// Alterar qualquer módulo/página/aba exige atualizar esta árvore no mesmo PR
// (a verificação em permissoes-arvore.test.ts falha caso contrário).

export const CHAVES_LEGADAS = [
  "dashboard",
  "agenda",
  "admissoes",
  "onboarding",
  "rh",
  "rh_salario",
  "tasks",
  "uniformes",
  "estoque_material",
  "diario",
  "diario_financeiro",
  "colonia",
  "colonia_financeiro",
  "esportes",
  "biblioteca",
  "pedagogico",
  "documentos",
  "cantina",
  "rematricula",
  "financeiro",
  "configuracoes",
  "financeiro_dashboard",
  "financeiro_upload",
  "financeiro_conciliacao",
  "financeiro_fluxo",
  "financeiro_inadimplencia",
  "financeiro_cobranca",
  "financeiro_atendimento",
  "financeiro_atendimento_ia",
  "financeiro_cartao",
  "financeiro_fundos",
] as const;
export type ChaveLegada = (typeof CHAVES_LEGADAS)[number];

/** OR entre os grupos; AND dentro de cada grupo. */
export type ExpressaoLegada = readonly (readonly ChaveLegada[])[];

export interface Legado {
  /** Visualizar na chave nova = expressão avaliada sobre o Visualizar antigo. */
  ver: ExpressaoLegada;
  /** Editar na chave nova = Visualizar novo AND expressão sobre o Editar antigo. */
  editar: ExpressaoLegada;
}

export type TipoNo = "grupo" | "modulo" | "pagina";

interface NoBase {
  readonly chave: string;
  readonly nome: string;
  readonly tipo: TipoNo;
  readonly filhos?: readonly NoBase[];
  readonly rota?: string;
  /** Módulo sem tela própria (só permissão): não aparece no menu nem tem rota. */
  readonly semRota?: boolean;
  readonly legado?: Legado;
  /** Grupo cujo único módulo aparece solto no menu (sem cabeçalho de grupo). */
  readonly soltoNoMenu?: boolean;
  /**
   * Nó que NÃO entra em user_permissions: o acesso vem de outra regra
   * ("admin" = interruptor Administrador; "professor" = vínculo em funcionarios.auth_user_id).
   */
  readonly acessoEspecial?: "admin" | "professor";
  /**
   * Condição de exibição do módulo no menu, quando diferente de "alguma folha
   * do módulo visível": todas as chaves de `exige` visíveis E alguma de
   * `qualquer` (padrão: as folhas do próprio módulo) visível.
   */
  readonly menu?: { readonly exige?: readonly string[]; readonly qualquer?: readonly string[] };
}

const l = (ver: ExpressaoLegada, editar: ExpressaoLegada = ver): Legado => ({ ver, editar });
const um = (c: ChaveLegada): Legado => l([[c]]);
/** Páginas do Financeiro: Visualizar vem da sub-chave; Editar pode vir do guarda-chuva `financeiro`. */
const fin = (ver: ChaveLegada, editar: ChaveLegada = ver): Legado => l([[ver]], [[editar]]);
/** Páginas que hoje exigem o guarda-chuva `financeiro` E a sub-chave para abrir (guard da rota). */
const finComGuarda = (sub: ChaveLegada): Legado => l([["financeiro", sub]], [[sub]]);

// Condições antigas do menu reproduzidas pela árvore (ver `menu` em NoBase).
/** Páginas do RH fora do Salário: o antigo `rh` (rh_salario sozinho não abre nem edita o módulo). */
export const PAGINAS_RH_SEM_SALARIO = [
  "rh.pessoal.efetivos",
  "rh.pessoal.terceirizados",
  "rh.pagamentos.vt",
  "rh.pagamentos.folhas",
  "rh.contracheques",
  "rh.ponto",
  "rh.estatistica",
  "rh.aniversarios",
] as const;
const MENU_FIN_SUBPAGINAS = [
  "extrato",
  "importar",
  "faturamento",
  "fluxo",
  "investimentos",
  "cartao",
  "inadimplencia",
  "regua.cobrancas",
  "regua.historico",
] as const;
/** Guarda-chuva do Financeiro (antigo `financeiro`): folha própria, sem tela. */
export const FINANCEIRO_DADOS = "financeiro.dados" as const;
/** Itens do grupo Financeiro: guarda-chuva (financeiro.dados ⇔ antigo `financeiro`) E a própria página. */
const MENU_FIN = { exige: [FINANCEIRO_DADOS] } as const;

export const ARVORE_PERMISSOES = [
  {
    chave: "grupo_dashboard",
    nome: "Dashboard",
    tipo: "grupo",
    soltoNoMenu: true,
    filhos: [
      { chave: "dashboard", nome: "Dashboard", tipo: "modulo", rota: "/", legado: um("dashboard") },
    ],
  },
  {
    chave: "grupo_comercial",
    nome: "Comercial",
    tipo: "grupo",
    filhos: [
      {
        chave: "agenda",
        nome: "Agenda",
        tipo: "modulo",
        rota: "/agenda",
        filhos: [
          { chave: "agenda.mes", nome: "Mês", tipo: "pagina", legado: um("agenda") },
          { chave: "agenda.semana", nome: "Semana", tipo: "pagina", legado: um("agenda") },
        ],
      },
      {
        chave: "admissoes",
        nome: "Admissões",
        tipo: "modulo",
        rota: "/admissoes",
        legado: um("admissoes"),
      },
      {
        chave: "eformulario",
        nome: "e-Formulário",
        tipo: "modulo",
        rota: "/matriculas",
        legado: um("admissoes"),
      },
      {
        chave: "matricula",
        nome: "Matrícula",
        tipo: "modulo",
        rota: "/rematricula-acompanhamento",
        filhos: [
          { chave: "matricula.alunos", nome: "Alunos", tipo: "pagina", legado: um("rematricula") },
          {
            chave: "matricula.contratos",
            nome: "Contratos",
            tipo: "pagina",
            legado: um("rematricula"),
          },
          {
            chave: "matricula.campanhas",
            nome: "Campanhas e Ano Vigente",
            tipo: "pagina",
            legado: um("rematricula"),
          },
        ],
      },
      {
        chave: "onboarding",
        nome: "Onboarding",
        tipo: "modulo",
        rota: "/onboarding",
        legado: um("onboarding"),
      },
    ],
  },
  {
    chave: "grupo_pedagogico",
    nome: "Pedagógico",
    tipo: "grupo",
    filhos: [
      {
        chave: "secretaria",
        nome: "Secretaria",
        tipo: "modulo",
        rota: "/pedagogico",
        filhos: [
          {
            chave: "secretaria.turmas",
            nome: "Turmas do ano",
            tipo: "pagina",
            legado: um("pedagogico"),
          },
          {
            chave: "secretaria.disciplinas",
            nome: "Disciplinas",
            tipo: "pagina",
            legado: um("pedagogico"),
          },
          {
            chave: "secretaria.atribuicoes",
            nome: "Atribuições",
            tipo: "pagina",
            legado: um("pedagogico"),
          },
          {
            chave: "secretaria.horarios",
            nome: "Grade de horários",
            tipo: "pagina",
            legado: um("pedagogico"),
          },
          {
            chave: "secretaria.calendario",
            nome: "Calendário letivo",
            tipo: "pagina",
            legado: um("pedagogico"),
          },
          {
            chave: "secretaria.notas",
            nome: "Notas e pareceres",
            tipo: "pagina",
            legado: um("pedagogico"),
          },
          {
            chave: "secretaria.acessos",
            nome: "Acesso de professores",
            tipo: "pagina",
            acessoEspecial: "admin",
          },
        ],
      },
      {
        chave: "professor",
        nome: "Minhas Turmas",
        tipo: "modulo",
        rota: "/professor",
        acessoEspecial: "professor",
        filhos: [
          {
            chave: "professor.diario",
            nome: "Diário do dia",
            tipo: "pagina",
            acessoEspecial: "professor",
          },
          {
            chave: "professor.avaliacoes",
            nome: "Avaliações e pareceres",
            tipo: "pagina",
            acessoEspecial: "professor",
          },
          {
            chave: "professor.turmas",
            nome: "Turmas",
            tipo: "pagina",
            acessoEspecial: "professor",
          },
        ],
      },
      {
        chave: "diario",
        nome: "Diário do Aluno",
        tipo: "modulo",
        rota: "/diario",
        filhos: [
          { chave: "diario.registro", nome: "Registro", tipo: "pagina", legado: um("diario") },
          { chave: "diario.extras", nome: "Consumos Extras", tipo: "pagina", legado: um("diario") },
          {
            chave: "diario.auditoria",
            nome: "Auditoria Sponte",
            tipo: "pagina",
            legado: um("diario_financeiro"),
          },
          {
            chave: "diario.faturamento",
            nome: "Faturamento",
            tipo: "pagina",
            legado: um("diario_financeiro"),
          },
        ],
      },
      {
        chave: "colonia",
        nome: "Colônia de Férias",
        tipo: "modulo",
        rota: "/colonia",
        filhos: [
          {
            chave: "colonia.registro",
            nome: "Registrar Consumos",
            tipo: "pagina",
            legado: um("colonia"),
          },
          {
            chave: "colonia.fechamento",
            nome: "Fechamento Semanal",
            tipo: "pagina",
            legado: l([["colonia_financeiro"]], [["colonia"]]),
          },
        ],
      },
      {
        chave: "uniformes",
        nome: "Uniformes",
        tipo: "modulo",
        rota: "/uniformes",
        filhos: [
          { chave: "uniformes.estoque", nome: "Estoque", tipo: "pagina", legado: um("uniformes") },
          {
            chave: "uniformes.vendas",
            nome: "Vendas do Ano",
            tipo: "pagina",
            legado: um("uniformes"),
          },
        ],
      },
      {
        chave: "estoque_material",
        nome: "Material Pedagógico",
        tipo: "modulo",
        rota: "/estoque-material",
        legado: um("estoque_material"),
      },
      {
        chave: "esportes",
        nome: "Esportes",
        tipo: "modulo",
        rota: "/esportes",
        legado: um("esportes"),
      },
      {
        chave: "biblioteca",
        nome: "Biblioteca",
        tipo: "modulo",
        rota: "/biblioteca",
        filhos: [
          {
            chave: "biblioteca.circulacao",
            nome: "Empréstimos",
            tipo: "pagina",
            legado: um("biblioteca"),
          },
          { chave: "biblioteca.acervo", nome: "Acervo", tipo: "pagina", legado: um("biblioteca") },
          {
            chave: "biblioteca.pendencias",
            nome: "Pendências",
            tipo: "pagina",
            legado: um("biblioteca"),
          },
        ],
      },
    ],
  },
  {
    chave: "grupo_operacional",
    nome: "Operacional",
    tipo: "grupo",
    filhos: [
      {
        chave: "rh",
        nome: "Recursos Humanos",
        tipo: "modulo",
        rota: "/rh",
        // Menu antigo: canView("rh") — quem só tem Salário (rh_salario) não vê o módulo.
        menu: { qualquer: PAGINAS_RH_SEM_SALARIO },
        filhos: [
          {
            chave: "rh.pessoal",
            nome: "Pessoal",
            tipo: "pagina",
            filhos: [
              { chave: "rh.pessoal.efetivos", nome: "Efetivos", tipo: "pagina", legado: um("rh") },
              {
                chave: "rh.pessoal.terceirizados",
                nome: "Terceirizados",
                tipo: "pagina",
                legado: um("rh"),
              },
            ],
          },
          {
            chave: "rh.pagamentos",
            nome: "Pagamentos",
            tipo: "pagina",
            filhos: [
              {
                chave: "rh.pagamentos.salario",
                nome: "Salário",
                tipo: "pagina",
                legado: um("rh_salario"),
              },
              {
                chave: "rh.pagamentos.vt",
                nome: "Vale Transporte",
                tipo: "pagina",
                legado: um("rh"),
              },
              {
                chave: "rh.pagamentos.folhas",
                nome: "Folhas Salvas",
                tipo: "pagina",
                legado: um("rh"),
              },
            ],
          },
          { chave: "rh.contracheques", nome: "Contracheques", tipo: "pagina", legado: um("rh") },
          { chave: "rh.ponto", nome: "Folha de Ponto", tipo: "pagina", legado: um("rh") },
          { chave: "rh.estatistica", nome: "Estatística", tipo: "pagina", legado: um("rh") },
          { chave: "rh.aniversarios", nome: "Aniversários", tipo: "pagina", legado: um("rh") },
        ],
      },
      {
        chave: "tasks",
        nome: "Tasks",
        tipo: "modulo",
        rota: "/tasks",
        filhos: [
          {
            chave: "tasks.tickets",
            nome: "Tickets",
            tipo: "pagina",
            filhos: [
              {
                chave: "tasks.tickets.recebidas",
                nome: "Recebidas",
                tipo: "pagina",
                legado: um("tasks"),
              },
              {
                chave: "tasks.tickets.enviadas",
                nome: "Enviadas",
                tipo: "pagina",
                legado: um("tasks"),
              },
            ],
          },
          { chave: "tasks.planner", nome: "Planner", tipo: "pagina", legado: um("tasks") },
        ],
      },
      {
        chave: "atendimento",
        nome: "Atendimento",
        tipo: "modulo",
        rota: "/atendimento",
        legado: um("financeiro_atendimento"),
      },
      {
        chave: "assistente_ia",
        nome: "Assistente de IA",
        tipo: "modulo",
        rota: "/atendimento-ia",
        filhos: [
          {
            chave: "assistente_ia.instrucoes",
            nome: "Instruções da IA",
            tipo: "pagina",
            legado: um("financeiro_atendimento_ia"),
          },
          {
            chave: "assistente_ia.exemplos",
            nome: "Exemplos de Treinamento",
            tipo: "pagina",
            legado: um("financeiro_atendimento_ia"),
          },
        ],
      },
      {
        chave: "documentos",
        nome: "Documentos",
        tipo: "modulo",
        rota: "/documentos",
        filhos: [
          {
            chave: "documentos.gerar",
            nome: "Gerar Documento",
            tipo: "pagina",
            filhos: [
              {
                chave: "documentos.gerar.individual",
                nome: "Aluno individual",
                tipo: "pagina",
                legado: um("documentos"),
              },
              {
                chave: "documentos.gerar.lote",
                nome: "Envio em lote",
                tipo: "pagina",
                legado: um("documentos"),
              },
            ],
          },
          {
            chave: "documentos.historico",
            nome: "Histórico",
            tipo: "pagina",
            legado: um("documentos"),
          },
          {
            chave: "documentos.zapsign",
            nome: "ZapSign",
            tipo: "pagina",
            legado: um("documentos"),
          },
        ],
      },
      {
        chave: "cantina",
        nome: "Cantina",
        tipo: "modulo",
        rota: "/cantina",
        legado: um("cantina"),
      },
      {
        chave: "mensagens",
        nome: "Mensagens Automáticas",
        tipo: "modulo",
        rota: "/cobranca-automatica",
        filhos: [
          {
            chave: "mensagens.cobrancas",
            nome: "Cobranças Automáticas",
            tipo: "pagina",
            legado: um("financeiro_cobranca"),
          },
          {
            chave: "mensagens.lembretes",
            nome: "Lembretes Automáticos",
            tipo: "pagina",
            legado: um("financeiro_cobranca"),
          },
          {
            chave: "mensagens.rematricula",
            nome: "Lembretes de Rematrícula",
            tipo: "pagina",
            legado: um("financeiro_cobranca"),
          },
          {
            chave: "mensagens.falhas",
            nome: "Falhas de Entrega",
            tipo: "pagina",
            legado: um("financeiro_cobranca"),
          },
        ],
      },
    ],
  },
  {
    chave: "grupo_financeiro",
    nome: "Financeiro",
    tipo: "grupo",
    filhos: [
      {
        chave: FINANCEIRO_DADOS,
        nome: "Financeiro: acesso aos dados",
        tipo: "modulo",
        semRota: true,
        legado: um("financeiro"),
      },
      {
        chave: "analises_ia",
        nome: "Análises com IA",
        tipo: "modulo",
        rota: "/analises-ia",
        legado: um("financeiro"),
        // Menu antigo: guarda-chuva `financeiro` E alguma subpágina do Financeiro.
        menu: { exige: [FINANCEIRO_DADOS], qualquer: MENU_FIN_SUBPAGINAS },
      },
      {
        chave: "extrato",
        nome: "Extrato Bancário",
        tipo: "modulo",
        rota: "/extrato-bancario",
        menu: MENU_FIN,
        legado: fin("financeiro_dashboard", "financeiro"),
      },
      {
        chave: "importar",
        nome: "Importar Extrato",
        tipo: "modulo",
        rota: "/upload",
        menu: MENU_FIN,
        legado: fin("financeiro_upload"),
      },
      {
        chave: "faturamento",
        nome: "Faturamento",
        tipo: "modulo",
        rota: "/conciliacao",
        menu: MENU_FIN,
        legado: fin("financeiro_conciliacao", "financeiro"),
      },
      {
        chave: "fluxo",
        nome: "Fluxo Futuro",
        tipo: "modulo",
        rota: "/fluxo-futuro",
        menu: MENU_FIN,
        legado: fin("financeiro_fluxo", "financeiro"),
      },
      {
        chave: "investimentos",
        nome: "Investimentos",
        tipo: "modulo",
        rota: "/fundos",
        menu: MENU_FIN,
        legado: fin("financeiro_fundos"),
      },
      {
        chave: "cartao",
        nome: "Cartão de Crédito",
        tipo: "modulo",
        rota: "/cartao-credito",
        menu: MENU_FIN,
        legado: fin("financeiro_cartao"),
      },
      {
        chave: "inadimplencia",
        nome: "Inadimplência",
        tipo: "modulo",
        rota: "/inadimplencia",
        menu: MENU_FIN,
        legado: fin("financeiro_inadimplencia"),
      },
      {
        chave: "regua",
        nome: "Régua de Cobrança",
        tipo: "modulo",
        rota: "/cobranca",
        menu: MENU_FIN,
        filhos: [
          {
            chave: "regua.cobrancas",
            nome: "Cobranças",
            tipo: "pagina",
            legado: finComGuarda("financeiro_cobranca"),
          },
          {
            chave: "regua.historico",
            nome: "Histórico de Envios",
            tipo: "pagina",
            legado: finComGuarda("financeiro_cobranca"),
          },
        ],
      },
    ],
  },
  {
    chave: "grupo_configuracoes",
    nome: "Configurações",
    tipo: "grupo",
    soltoNoMenu: true,
    filhos: [
      {
        chave: "configuracoes",
        nome: "Configurações",
        tipo: "modulo",
        rota: "/configuracoes",
        filhos: [
          {
            chave: "configuracoes.despesas",
            nome: "Despesas",
            tipo: "pagina",
            legado: um("configuracoes"),
          },
          {
            chave: "configuracoes.receitas",
            nome: "Receitas",
            tipo: "pagina",
            legado: um("configuracoes"),
          },
          {
            chave: "configuracoes.regras",
            nome: "Regras",
            tipo: "pagina",
            legado: um("configuracoes"),
          },
          {
            chave: "configuracoes.cadastros",
            nome: "Cadastros Gerais",
            tipo: "pagina",
            filhos: [
              {
                chave: "configuracoes.cadastros.valor_material",
                nome: "Valor Material Pedagógico",
                tipo: "pagina",
                legado: l([["configuracoes", "rematricula"]], [["rematricula"]]),
              },
              {
                chave: "configuracoes.cadastros.valor_matricula",
                nome: "Valor Matrícula",
                tipo: "pagina",
                legado: l([["configuracoes", "rematricula"]], [["rematricula"]]),
              },
              {
                chave: "configuracoes.cadastros.valor_pacotes",
                nome: "Valor Pacotes Extras",
                tipo: "pagina",
                legado: l([["configuracoes", "rematricula"]], [["rematricula"]]),
              },
              {
                chave: "configuracoes.cadastros.valor_diario",
                nome: "Valor Diário do Aluno",
                tipo: "pagina",
                legado: l([["configuracoes", "diario_financeiro"]], [["diario_financeiro"]]),
              },
              {
                chave: "configuracoes.cadastros.valor_colonia",
                nome: "Valor Colônia de Férias",
                tipo: "pagina",
                legado: l(
                  [
                    ["configuracoes", "colonia"],
                    ["configuracoes", "colonia_financeiro"],
                  ],
                  [["colonia_financeiro"]],
                ),
              },
              {
                chave: "configuracoes.cadastros.valor_biblioteca",
                nome: "Valor Biblioteca",
                tipo: "pagina",
                legado: l([["configuracoes", "biblioteca"]], [["biblioteca"]]),
              },
            ],
          },
          {
            chave: "configuracoes.colegios",
            nome: "Dados dos Colégios",
            tipo: "pagina",
            legado: l([["configuracoes", "documentos"]], [["documentos"]]),
          },
          {
            chave: "configuracoes.acessos",
            nome: "Gerenciar Acessos",
            tipo: "pagina",
            acessoEspecial: "admin",
          },
        ],
      },
    ],
  },
] as const satisfies readonly NoBase[];

// ---------- Tipos derivados da árvore ----------

type ChavesDe<T> = T extends readonly (infer N)[]
  ? N extends { readonly chave: infer C; readonly filhos?: infer F }
    ? C | ChavesDe<F>
    : never
  : never;

/** Toda chave da árvore (grupos, módulos, páginas e subpáginas). */
export type ChaveNo = ChavesDe<typeof ARVORE_PERMISSOES>;
/** Chaves que podem ser checadas em canView/canEdit e no servidor (módulos e páginas). */
export type ChavePermissao = Exclude<ChaveNo, `grupo_${string}`>;

export interface NoArvore extends NoBase {
  readonly chave: ChaveNo;
  readonly filhos?: readonly NoArvore[];
}

// ---------- Percurso ----------

function percorrer(
  nos: readonly NoBase[],
  visita: (no: NoBase, caminho: NoBase[]) => void,
  caminho: NoBase[] = [],
) {
  for (const no of nos) {
    const atual = [...caminho, no];
    visita(no, atual);
    if (no.filhos) percorrer(no.filhos, visita, atual);
  }
}

const TODOS_OS_NOS: NoArvore[] = [];
const CAMINHOS = new Map<string, NoArvore[]>();
percorrer(ARVORE_PERMISSOES, (no, caminho) => {
  TODOS_OS_NOS.push(no as NoArvore);
  CAMINHOS.set(no.chave, caminho as NoArvore[]);
});

/** Todos os nós, em ordem de exibição (pré-ordem). */
export function listarNos(): readonly NoArvore[] {
  return TODOS_OS_NOS;
}

export function noPorChave(chave: string): NoArvore | undefined {
  const c = CAMINHOS.get(chave);
  return c ? c[c.length - 1] : undefined;
}

export function ehChavePermissao(chave: string): chave is ChavePermissao {
  const no = noPorChave(chave);
  return !!no && no.tipo !== "grupo";
}

/** Chave de folha persistível (a única aceita pelas checagens do servidor e do SQL). */
export function ehChaveGravavel(chave: string): chave is ChavePermissao {
  return FOLHAS_GRAVAVEIS.has(chave);
}

/** Caminho "Grupo > Módulo > Página" com os nomes exibidos. */
export function caminhoDoNo(chave: string): string {
  return (CAMINHOS.get(chave) ?? []).map((n) => n.nome).join(" > ");
}

/** Folhas (onde a permissão é gravada): página sem filhos ou módulo sem página. */
export function folhasDe(no: NoBase): NoArvore[] {
  if (!no.filhos || no.filhos.length === 0) return no.tipo === "grupo" ? [] : [no as NoArvore];
  return no.filhos.flatMap((f) => folhasDe(f));
}

/** Folhas persistidas em user_permissions (exclui acessos especiais: admin/professor). */
export const FOLHAS_PERMISSAO: readonly NoArvore[] = ARVORE_PERMISSOES.flatMap((g) =>
  folhasDe(g),
).filter((n) => !n.acessoEspecial);

/** Chaves gravadas em user_permissions (valores novos do enum app_module). */
export const CHAVES_PERMISSAO_GRAVAVEIS: readonly string[] = FOLHAS_PERMISSAO.map((n) => n.chave);
const FOLHAS_GRAVAVEIS = new Set<string>(CHAVES_PERMISSAO_GRAVAVEIS);

/** Módulos (com rota) na ordem do menu. */
export const MODULOS: readonly NoArvore[] = TODOS_OS_NOS.filter((n) => n.tipo === "modulo");

export function moduloDaRota(rota: string): NoArvore | undefined {
  return MODULOS.find((m) => m.rota === rota);
}

/** Último segmento da chave — usado como `value` das abas (Tabs). */
export function idDaAba(chave: string): string {
  const i = chave.lastIndexOf(".");
  return i < 0 ? chave : chave.slice(i + 1);
}

export interface Aba {
  chave: ChavePermissao;
  id: string;
  nome: string;
}

/**
 * Abas (páginas filhas diretas) de um nó, na ordem da árvore, só as visíveis.
 * `podeVer` é o canView de usePermissions (que já sobe a visibilidade das folhas).
 */
export function abasVisiveis(
  chavePai: ChavePermissao,
  podeVer: (c: ChavePermissao) => boolean,
): Aba[] {
  const pai = noPorChave(chavePai);
  return (pai?.filhos ?? [])
    .filter((f) => podeVer(f.chave as ChavePermissao))
    .map((f) => ({ chave: f.chave as ChavePermissao, id: idDaAba(f.chave), nome: f.nome }));
}

export function abasDe(chavePai: ChavePermissao): Aba[] {
  return abasVisiveis(chavePai, () => true);
}

/**
 * Módulo aparece no menu quando todas as chaves de `menu.exige` são visíveis e
 * alguma de `menu.qualquer` (padrão: as folhas do próprio módulo) é visível.
 * Reproduz as condições do menu antigo (guarda-chuva Financeiro, RH sem Salário).
 */
export function moduloVisivelNoMenu(
  modulo: NoBase,
  podeVer: (c: ChavePermissao) => boolean,
): boolean {
  const exige = modulo.menu?.exige ?? [];
  if (!exige.every((c) => podeVer(c as ChavePermissao))) return false;
  const qualquer = modulo.menu?.qualquer ?? folhasDe(modulo).map((f) => f.chave);
  return qualquer.some((c) => podeVer(c as ChavePermissao));
}

// ---------- Avaliação de permissão a partir das linhas gravadas ----------

export interface LinhaPermissao {
  module: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface Permissoes {
  ver: (chave: ChavePermissao) => boolean;
  editar: (chave: ChavePermissao) => boolean;
}

/**
 * Só linhas de folhas persistíveis (CHAVES_PERMISSAO_GRAVAVEIS) contam; linhas
 * com chave antiga ou de nó não-folha são ignoradas. Módulo/grupo é
 * visível/editável quando alguma folha descendente (prefixo "chave.") é.
 * Editar implica Visualizar. Mesma regra de can_view_pagina/can_edit_pagina.
 */
export function avaliarPermissoes(linhas: readonly LinhaPermissao[], admin: boolean): Permissoes {
  if (admin) return { ver: () => true, editar: () => true };
  const ver = new Set<string>();
  const editar = new Set<string>();
  for (const r of linhas) {
    if (!FOLHAS_GRAVAVEIS.has(r.module)) continue;
    if (r.can_edit) editar.add(r.module);
    if (r.can_view || r.can_edit) ver.add(r.module);
  }
  const temAbaixo = (set: Set<string>, chave: string) => {
    if (set.has(chave)) return true;
    const prefixo = chave + ".";
    for (const c of set) if (c.startsWith(prefixo)) return true;
    return false;
  };
  return {
    ver: (chave) => temAbaixo(ver, chave),
    editar: (chave) => temAbaixo(editar, chave),
  };
}

// ---------- Correspondência legado → árvore ----------

export type MatrizLegada = Partial<Record<ChaveLegada, { view: boolean; edit: boolean }>>;

function avaliarExpressao(expr: ExpressaoLegada, tem: (c: ChaveLegada) => boolean): boolean {
  return expr.some((grupo) => grupo.every(tem));
}

/** Permissão de uma folha nova calculada a partir da matriz legada de um usuário. */
export function permissaoDerivadaDoLegado(
  no: NoBase,
  legada: MatrizLegada,
): { view: boolean; edit: boolean } {
  if (!no.legado) return { view: false, edit: false };
  const view = avaliarExpressao(no.legado.ver, (c) => !!(legada[c]?.view || legada[c]?.edit));
  const edit = view && avaliarExpressao(no.legado.editar, (c) => !!legada[c]?.edit);
  return { view, edit };
}

/** Linhas novas de user_permissions derivadas das linhas legadas (mesma regra da migration). */
export function migrarLinhasLegadas(linhas: readonly LinhaPermissao[]): LinhaPermissao[] {
  const legada: MatrizLegada = {};
  for (const r of linhas) {
    if ((CHAVES_LEGADAS as readonly string[]).includes(r.module)) {
      legada[r.module as ChaveLegada] = { view: !!r.can_view || !!r.can_edit, edit: !!r.can_edit };
    }
  }
  const novas: LinhaPermissao[] = [];
  for (const no of FOLHAS_PERMISSAO) {
    const p = permissaoDerivadaDoLegado(no, legada);
    if (p.view || p.edit)
      novas.push({ module: no.chave, can_view: p.view || p.edit, can_edit: p.edit });
  }
  return novas;
}
