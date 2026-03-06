import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

const ParamsSchema = z.object({ id: z.string().uuid() });

const BodySchema = z.object({
    department: z.string().min(1).max(40), // store as enum string
    seniority_level: z.string().min(1).max(80),
    ai_opportunities_notes: z.string().min(1).max(4000),
  });

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

function unauthorized(message?: string) {
  return NextResponse.json({ ok: false, error: "Unauthorized", message }, { status: 401 });
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) return unauthorized(error.message);
    if (!user) return unauthorized();

    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
    }

    const assessmentId = parsed.data.id;

    const participant = await prisma.participant.findFirst({
      where: { assessment_id: assessmentId, user_id: user.id },
      select: {
        id: true,
        department: true,
        seniority_level: true,
        ai_opportunities_notes: true,
        Assessment: {
          select: {
            id: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!participant) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(
      {
        ok: true,
        participant: {
            id: participant.id,
            department: participant.department ?? null,
            seniority_level: participant.seniority_level ?? null,
            ai_opportunities_notes: participant.ai_opportunities_notes ?? null,
          }, 
        organization: {
          id: participant.Assessment.organization.id,
          name: participant.Assessment.organization.name,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Internal server error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) return unauthorized(error.message);
    if (!user) return unauthorized();

    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
    }

    const assessmentId = parsed.data.id;

    const participant = await prisma.participant.findFirst({
      where: { assessment_id: assessmentId, user_id: user.id },
      select: { id: true },
    });

    if (!participant) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const bodyJson = await req.json().catch(() => null);
    const bodyParsed = BodySchema.safeParse(bodyJson);
    if (!bodyParsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid input", issues: bodyParsed.error.issues },
        { status: 400 }
      );
    }

    const updated = await prisma.participant.update({
        where: { id: participant.id },
        data: {
          department: bodyParsed.data.department as any,
          seniority_level: bodyParsed.data.seniority_level.trim(),
          ai_opportunities_notes: bodyParsed.data.ai_opportunities_notes.trim(),
        },
        select: { id: true, department: true, seniority_level: true, ai_opportunities_notes: true },
      });

    return NextResponse.json({ ok: true, participant: updated }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Internal server error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}