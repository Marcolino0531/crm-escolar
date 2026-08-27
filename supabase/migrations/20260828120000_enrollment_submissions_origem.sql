-- Formulário de matrícula nativo (/matricula) convivendo com o Google Forms.
--
-- `origem` distingue de onde a submissão veio ('google_forms' | 'site') e
-- `ip_hash` guarda apenas o SHA-256 do IP de quem enviou pelo site — é a chave
-- do limite de envios por IP/hora da página pública. O IP em texto nunca é
-- persistido.

ALTER TABLE public.enrollment_submissions
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'google_forms',
  ADD COLUMN IF NOT EXISTS ip_hash text;

-- Contagem de submissões recentes de um IP (rate limit) sem varrer a tabela.
CREATE INDEX IF NOT EXISTS enrollment_submissions_ip_idx
  ON public.enrollment_submissions (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

NOTIFY pgrst, 'reload schema';
