import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAdminEmail } from "@/lib/admin";

const ParamsSchema = z.object({ id: z.string().uuid() });

const DeleteQuerySchema = z.object({
  participantId: z.string().uuid(),
});

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
    );
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

async function assertAdmin(req: NextRequest) {
  // DEV BYPASS: lets you test locally without a browser session cookie
  if (process.env.NODE_ENV !== "production") {
    const dev = req.headers.get("x-dev-admin");
    if (dev === "1" || dev?.toLowerCase() === "true") {
      return { ok: true as const, mode: "dev" as const, email: "dev-bypass" };
    }
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false as const,
      status: 401 as const,
      error: "Unauthorized" as const,
    };
  }

  const email = user.email ?? null;
  if (!isAdminEmail(email)) {
    return { ok: false as const, status: 403 as const, error: "Forbidden" as const };
  }

  return { ok: true as const, mode: "session" as const, email: email ?? "unknown" };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await assertAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    const params = await context.params;
    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid assessment id (UUID)" },
        { status: 400 }
      );
    }

    const assessmentId = parsedParams.data.id;

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        status: true,
        locked_at: true,
        Participant: {
          select: {
            id: true,
            email: true,
            department: true,
            role: true,
            seniority_level: true,
            invite_sent_at: true,
            invite_accepted_at: true,
            completed_at: true,
            created_at: true,
          },
          orderBy: { created_at: "asc" },
        },
      },
    });

    if (!assessment) {
      return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
    }

    const participantsTotal = assessment.Participant.length;
    const participantsCompleted = assessment.Participant.filter(
      (p) => p.completed_at !== null
    ).length;

    const isLocked =
      participantsTotal > 0 && participantsCompleted === participantsTotal;

    return NextResponse.json(
      {
        ok: true,
        isLocked,
        participantsTotal,
        participantsCompleted,
        status: assessment.status,
        locked_at: assessment.locked_at,
        participants: assessment.Participant,
        mode: admin.mode,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("GET participants error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await assertAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    const params = await context.params;
    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid assessment id (UUID)" },
        { status: 400 }
      );
    }

    const assessmentId = parsedParams.data.id;

    const url = new URL(req.url);
    const participantId = url.searchParams.get("participantId") ?? "";

    const parsedQuery = DeleteQuerySchema.safeParse({ participantId });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { ok: false, error: "participantId is required (UUID)" },
        { status: 400 }
      );
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        Participant: { select: { id: true, completed_at: true } },
      },
    });

    if (!assessment) {
      return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
    }

    const participantsTotal = assessment.Participant.length;
    const participantsCompleted = assessment.Participant.filter(
      (p) => p.completed_at !== null
    ).length;

    const isLocked =
      participantsTotal > 0 && participantsCompleted === participantsTotal;

    if (isLocked) {
      return NextResponse.json(
        { ok: false, error: "Assessment is locked. Participants are read-only." },
        { status: 423 }
      );
    }

    const target = await prisma.participant.findFirst({
      where: { id: parsedQuery.data.participantId, assessment_id: assessmentId },
      select: { id: true, completed_at: true },
    });

    if (!target) {
      return NextResponse.json({ ok: false, error: "Participant not found" }, { status: 404 });
    }

    if (target.completed_at) {
      return NextResponse.json(
        { ok: false, error: "Cannot delete a completed participant." },
        { status: 409 }
      );
    }

    // This will cascade delete Responses (due to your schema relations)
    await prisma.participant.delete({
      where: { id: target.id },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("DELETE participant error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}