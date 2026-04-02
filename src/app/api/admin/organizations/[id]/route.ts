import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAdminEmail } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

const ParamsSchema = z.object({ id: z.string().uuid() });

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

/**
 * Permanently delete an organization and dependent rows (assessments, participants, documents, narratives, etc.).
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const email = await getSessionEmail();
    if (!isAdminEmail(email)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = ParamsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
    }

    const id = parsed.data.id;

    const org = await prisma.organization.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!org) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    await prisma.organization.delete({ where: { id } });

    return NextResponse.json({ ok: true, deleted_id: id, name: org.name }, { status: 200 });
  } catch (err: any) {
    console.error("DELETE /api/admin/organizations/[id]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Delete failed" },
      { status: 500 }
    );
  }
}
