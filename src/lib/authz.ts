import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
/**
 * NOTE: This file exports isAdminEmail and requireAdmin.
 * Some routes import isAdminEmail from "@/lib/authz".
 */

export function getAdminEmailAllowlist(): string[] {
  const raw = process.env.NORTHLINE_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;

  const allowlist = getAdminEmailAllowlist();

  // Fail closed if env var is missing
  if (allowlist.length === 0) return false;

  return allowlist.includes(email.toLowerCase());
};

export async function requireAdmin() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? null;

  if (!isAdminEmail(email)) {
    redirect("/admin/login");
  }

  return { user, email };
}