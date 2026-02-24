// src/app/api/assessments/[id]/participant/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const ParamsSchema = z.object({ id: z.string().uuid() });

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

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

async function ensureParticipantForUser(assessmentId: string, userId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, organization_id: true, status: true, type: true },
  });

  if (!assessment) {
    return {
      ok: false as const,
      status: 404 as const,
      error: "Assessment not found",
    };
  }

  const existing = await prisma.participant.findFirst({
    where: {
      assessment_id: assessmentId,
      user_id: userId,
    },
    select: {
      id: true,
      assessment_id: true,
      organization_id: true,
      user_id: true,
      created_at: true,
    },
  });

  if (existing) {
    return {
      ok: true as const,
      status: 200 as const,
      participant: existing,
      reused: true as const,
    };
  }

  try {
    const created = await prisma.participant.create({
      data: {
        assessment_id: assessmentId,
        organization_id: assessment.organization_id,
        user_id: userId,
      },
      select: {
        id: true,
        assessment_id: true,
        organization_id: true,
        user_id: true,
        created_at: true,
      },
    });

    return {
      ok: true as const,
      status: 201 as const,
      participant: created,
      reused: false as const,
    };
  } catch (err: any) {
    // Race condition fallback (two tabs / double-click)
    if (err?.code === "P2002") {
      const again = await prisma.participant.findFirst({
        where: { assessment_id: assessmentId, user_id: userId },
        select: {
          id: true,
          assessment_id: true,
          organization_id: true,
          user_id: true,
          created_at: true,
        },
      });

      if (again) {
        return {
          ok: true as const,
          status: 200 as const,
          participant: again,
          reused: true as const,
        };
      }
    }

    throw err;
  }
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // --- AUTH GATE: require logged-in user (server-trusted) ---
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", message: userError.message },
        { status: 401 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    // --- END AUTH GATE ---

    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid assessment id (UUID)" },
        { status: 400 }
      );
    }

    const assessmentId = parsed.data.id;

    const result = await ensureParticipantForUser(assessmentId, user.id);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(
      { ok: true, participant: result.participant, reused: result.reused },
      { status: result.status }
    );
  } catch (err: any) {
    console.error("POST /api/assessments/[id]/participant error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error.",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}