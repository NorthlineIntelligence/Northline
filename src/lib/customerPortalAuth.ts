import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

export async function getCustomerPortalViewer() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // ignore set failures in server contexts that disallow it
        }
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.id || !user.email) return null;

  const participant = await prisma.participant.findFirst({
    where: {
      user_id: user.id,
      portal_role: { not: "NONE" },
    },
    select: {
      id: true,
      email: true,
      portal_role: true,
      assessment_id: true,
      organization_id: true,
      can_view_executive_insights: true,
      completed_at: true,
      organization: { select: { name: true } },
    },
    orderBy: { created_at: "desc" },
  });

  if (!participant) return null;

  return {
    userId: user.id,
    userEmail: user.email,
    participant,
  };
}
