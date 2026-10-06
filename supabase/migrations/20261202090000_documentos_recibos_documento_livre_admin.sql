-- Documentos > Documento livre: só admin grava e lê linhas de tipo
-- 'documento_livre' em documentos_recibos, mesmo chamando o banco direto.
--
-- Altera apenas as policies de INSERT e SELECT. Cada uma mantém a condição
-- exatamente como ficou em 20261119090100_permissoes_arvore_copia.sql e ganha,
-- com AND, (tipo <> 'documento_livre' OR admin). Admin = public.has_role(...,
-- 'admin'), a mesma função usada pelas demais policies do banco.
-- `tipo` é NOT NULL (20260830120000_documentos_tipo.sql), então o <> não cai em NULL.
-- Nenhuma tabela, coluna, chave de permissão ou valor de enum novo; nenhuma
-- linha alterada. Para os outros tipos nada muda.

BEGIN;

ALTER POLICY "documentos recibos insert" ON public.documentos_recibos
  WITH CHECK (
    (
      public.can_edit_pagina(auth.uid(), 'documentos.gerar.individual')
      OR public.can_edit_pagina(auth.uid(), 'documentos.historico')
    )
    AND (tipo <> 'documento_livre' OR public.has_role(auth.uid(), 'admin'::public.app_role))
  );

ALTER POLICY "documentos recibos select" ON public.documentos_recibos
  USING (
    (
      public.can_view_pagina(auth.uid(), 'documentos.gerar.individual')
      OR public.can_view_pagina(auth.uid(), 'documentos.gerar.lote')
      OR public.can_view_pagina(auth.uid(), 'documentos.historico')
      OR public.can_view_pagina(auth.uid(), 'documentos.zapsign')
    )
    AND (tipo <> 'documento_livre' OR public.has_role(auth.uid(), 'admin'::public.app_role))
  );

COMMIT;
