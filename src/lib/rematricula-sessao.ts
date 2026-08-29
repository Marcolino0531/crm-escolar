// Onde o token de sessão do portal de Rematrícula vive no navegador.
//
// sessionStorage (e não localStorage) de propósito: o token é opaco, tem
// validade curta no servidor e não deve sobreviver ao fechamento da aba. A rota
// /rematricula/verificar grava a chave depois de queimar o link mágico, e
// /rematricula a lê para abrir o formulário.
export const CHAVE_SESSAO_REMATRICULA = "rematricula:sessao";
