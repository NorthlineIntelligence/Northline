import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAdminEmail } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

async function getSessionEmail() {
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
  return user?.email ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const email = await getSessionEmail();
    if (!isAdminEmail(email)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { organizationId } = body;

    if (!organizationId || typeof organizationId !== "string") {
      return NextResponse.json({ ok: false, error: "Missing organizationId" }, { status: 400 });
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { show_project_scope_review: true },
    });

    if (!org) {
      return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
    }

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: { show_project_scope_review: !org.show_project_scope_review },
      select: { id: true, show_project_scope_review: true },
    });

    return NextResponse.json({
      ok: true,
      show_project_scope_review: updated.show_project_scope_review,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
