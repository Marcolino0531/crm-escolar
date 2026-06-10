import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Directory of all users, used by the Tasks module so any authenticated user
// can pick a recipient. Returns only id + display name — the e-mail is NOT
// exposed, to avoid leaking PII between colleagues in the recipient dropdown.
export const listDirectoryUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    return data.users.map((u) => {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const rawName =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        "";
      // Fall back to the email's local part as a display name (e-mail itself is
      // not returned to the client).
      const name = rawName || (u.email ? u.email.split("@")[0] : "Usuário");
      return { id: u.id, name };
    });
  });
