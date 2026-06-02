-- Per-unit (school) access control.
-- Stores which schools each user may access. Empty set = no explicit restriction
-- (treated as "all schools" by the client, so legacy users are not locked out).
-- Admins always have access to every school.

CREATE TABLE IF NOT EXISTS public.user_schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, school_id)
);

CREATE INDEX IF NOT EXISTS user_schools_user_id_idx ON public.user_schools (user_id);

ALTER TABLE public.user_schools ENABLE ROW LEVEL SECURITY;

-- Helper: can a user access a given school? Admin always passes; a user with NO
-- explicit rows is considered unrestricted (access to all), preserving legacy
-- behavior; otherwise the school must be in the user's allowed set.
CREATE OR REPLACE FUNCTION public.can_access_school(_user_id uuid, _school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR NOT EXISTS (SELECT 1 FROM public.user_schools WHERE user_id = _user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_schools
      WHERE user_id = _user_id AND school_id = _school_id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_school(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_school(uuid, uuid) TO authenticated;

-- ---------- RLS on user_schools ----------
DROP POLICY IF EXISTS "users read own schools" ON public.user_schools;
CREATE POLICY "users read own schools" ON public.user_schools
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins manage schools" ON public.user_schools;
CREATE POLICY "admins manage schools" ON public.user_schools
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
