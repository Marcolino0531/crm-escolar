-- Módulo Documentos — quem representa o colégio como CREDOR nos documentos
-- jurídicos (Termo de Confissão de Dívida) e o número da OAB.
--
-- É dado do cadastro da unidade, e não de quem assina o recibo: no recibo
-- assina a secretaria/direção (`assinante_nome`), no termo assina o advogado
-- que representa o CREDOR. Por isso são colunas próprias.
--
-- As policies de `documentos_colegios` já cobrem estas colunas (RLS é por
-- tabela e a edição continua liberada só para quem edita o módulo Documentos).

ALTER TABLE public.documentos_colegios
  ADD COLUMN IF NOT EXISTS representante_nome text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS representante_oab text NOT NULL DEFAULT '';
