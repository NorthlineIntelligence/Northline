// src/app/api/admin/assessments/[id]/narrative/promote/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";

const ParamsSchema = z.object({ id: z.string().uuid() });

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)");
  }

  return createServerClient(supabaseUrl, supabaseKey, {
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
          // ignore
        }
      },
    },
  });
}

async function requireAdminFromSession() {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user ?? null;

  if (error || !user) {
    return { ok: false as const, status: 401 as const };
  }

  if (!isAdminEmail(user.email ?? null)) {
    return { ok: false as const, status: 403 as const };
  }

  return { ok: true as const, status: 200 as const, user };
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdminFromSession();
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: admin.status });
    }

    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }

    const assessmentId = parsed.data.id;

    const latestDraft = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId, status: "DRAFT" },
      orderBy: [{ version: "desc" }],
    });

    if (!latestDraft) {
      return NextResponse.json(
        { ok: false, error: "No DRAFT narrative found to promote." },
        { status: 404 }
      );
    }

    const existingFinal = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId, status: "FINAL" },
      orderBy: [{ version: "desc" }],
    });

    const promoted = await prisma.$transaction(async (tx) => {
      // Archive old FINAL (if exists)
      if (existingFinal?.id) {
        await tx.assessmentNarrative.update({
          where: { id: existingFinal.id },
          data: { status: "ARCHIVED" },
        });
      }

      // Promote latest DRAFT to FINAL
      const final = await tx.assessmentNarrative.update({
        where: { id: latestDraft.id },
        data: { status: "FINAL" },
      });

      // Lock the assessment once final narrative exists
      await tx.assessment.updateMany({
        where: { id: assessmentId, locked_at: null },
        data: { locked_at: new Date() },
      });

      return final;
    });

    return NextResponse.json({ ok: true, narrative: promoted }, { status: 200 });
  } catch (err: any) {
    console.error("POST /api/admin/assessments/[id]/narrative/promote error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
