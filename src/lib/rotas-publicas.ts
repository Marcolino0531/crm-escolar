// Rotas públicas: usadas pelos PAIS, que não têm usuário no Supabase Auth — o
// portal de recarga e o de rematrícula autenticam pelo CPF do aluno na própria
// tela e o formulário de matrícula é protegido por captcha, então nenhuma delas
// passa pelo login interno nem pelo shell do app. Os painéis internos
// equivalentes (/matriculas, /rematricula-acompanhamento) continuam exigindo
// login: a comparação é por segmento, nunca por prefixo de string.
export const ROTAS_PUBLICAS = ["/portal-cantina", "/matricula", "/rematricula"] as const;

export function ehRotaPublica(pathname: string): boolean {
  const limpo = pathname.replace(/\/+$/, "") || "/";
  return ROTAS_PUBLICAS.some((r) => limpo === r || limpo.startsWith(`${r}/`));
}
