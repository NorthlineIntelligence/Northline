import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const ParamsSchema = z.object({ id: z.string().uuid() });

const BodySchema = z.object({
  department: z.string().min(1),
  seniority_level: z.string().min(1).max(120),
  ai_opportunities_notes: z.string().min(1).max(8000),
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
        } catch {}
      },
    },
  });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) return NextResponse.json({ ok: false, error: "Unauthorized", message: userError.message }, { status: 401 });
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const params = await context.params;
    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });

    const assessmentId = parsedParams.data.id;

    const bodyJson = await req.json().catch(() => null);
    const parsedBody = BodySchema.safeParse(bodyJson);
    if (!parsedBody.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid input", issues: parsedBody.error.issues.map(i => ({ path: i.path, message: i.message })) },
        { status: 400 }
      );
    }

    // membership + update the participant row for THIS user+assessment
    const participant = await prisma.participant.findFirst({
      where: { assessment_id: assessmentId, user_id: user.id },
      select: { id: true },
    });

    if (!participant) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const updated = await prisma.participant.update({
      where: { id: participant.id },
      data: {
        department: parsedBody.data.department as any, // prisma enum
        seniority_level: parsedBody.data.seniority_level.trim(),
        ai_opportunities_notes: parsedBody.data.ai_opportunities_notes.trim(),
      },
      select: { id: true, department: true, seniority_level: true },
    });

    return NextResponse.json({ ok: true, participant: updated }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Internal Server Error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}