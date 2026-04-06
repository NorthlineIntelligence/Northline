// src/app/api/assessments/[id]/results/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { buildAssessmentResultsPayload } from "@/lib/assessmentResultsEngine";
import { narrativeCacheGet, narrativeCacheSet, narrativeInflight } from "@/lib/narrativeCache";

const ParamsSchema = z.object({ id: z.string().uuid() });

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
          // ignore (edge/runtime can throw)
        }
      },
    },
  });
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function unauthorized(message?: string) {
  return NextResponse.json(
    { ok: false, error: "Unauthorized", message: message ?? "Auth session missing!" },
    { status: 401 }
  );
}

/**
 * Auth: allow either:
 *  - Supabase session (admin/team member)
 *  - Invite link (email + token)
 *
 * Returns a cacheKeyOwner string to scope caching safely by viewer.
 */
async function authorizeForAssessment(req: NextRequest, assessmentId: string) {
  const url = req.nextUrl;
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const token = (url.searchParams.get("token") ?? "").trim();

  // 1) Invite token path
  if (email && token) {
    const tokenHash = sha256Hex(token);

    const participant = await prisma.participant.findFirst({
      where: {
        assessment_id: assessmentId,
        email,
        invite_token_hash: tokenHash,
        OR: [{ invite_token_expires_at: null }, { invite_token_expires_at: { gt: new Date() } }],
      },
      select: { id: true },
    });

    if (!participant) return { ok: false as const };

    return { ok: true as const, cacheKeyOwner: `invite:${participant.id}` };
  }

  // 2) Supabase session path
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.id) return { ok: false as const };

  const membership = await prisma.participant.findFirst({
    where: { assessment_id: assessmentId, user_id: user.id },
    select: { id: true },
  });

  if (!membership) {
    if (isAdminEmail(user.email ?? null)) {
      return { ok: true as const, cacheKeyOwner: `admin:${user.id}` };
    }
    return { ok: false as const };
  }

  return { ok: true as const, cacheKeyOwner: `admin:${user.id}` };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }
    const assessmentId = parsed.data.id;

    // AUTH (session OR invite)
    const auth = await authorizeForAssessment(req, assessmentId);
    if (!auth.ok) return unauthorized();

    // Cache scoped by viewer type
    const cacheKey = `assessment-results:${assessmentId}:${auth.cacheKeyOwner}`;

    const cached = narrativeCacheGet(cacheKey);
    if (cached) return NextResponse.json(cached, { status: 200 });

    const existingInflight = narrativeInflight.get(cacheKey);
    if (existingInflight) {
      const payload = await existingInflight;
      return NextResponse.json(payload, { status: 200 });
    }

    const p = (async () => {
      // Build the full results payload (existing behavior)
      const results = await buildAssessmentResultsPayload({ assessmentId });

           // Add participant completion stats (so UI can lock without guessing)
      // IMPORTANT: exclude the admin “owner” participant row so single-participant assessments work.
      const participantsRaw = await prisma.participant.findMany({
        where: { assessment_id: assessmentId },
        select: {
          user_id: true,
          email: true,
          completed_at: true,
        },
      });

      const reportingParticipants = participantsRaw.filter((p) => {
        const email = (p.email ?? "").trim().toLowerCase();
        const isOwnerAdmin = Boolean(p.user_id) && isAdminEmail(email);
        return !isOwnerAdmin;
      });

      const participantsTotal = reportingParticipants.length;
      const participantsCompleted = reportingParticipants.filter((p) => p.completed_at != null).length;

      const allParticipantsCompleted =
        participantsTotal > 0 && participantsCompleted >= participantsTotal;
      return {
        ok: results.ok,
        ...results.body,

        // NEW: completion fields for UI enforcement
        participants_total: participantsTotal,
        participants_completed: participantsCompleted,
        all_participants_completed: allParticipantsCompleted,
      };
    })();

    narrativeInflight.set(cacheKey, p);

    let payload: any;
    try {
      payload = await p;
    } finally {
      narrativeInflight.delete(cacheKey);
    }

    narrativeCacheSet(cacheKey, payload);
    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/assessments/[id]/results error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}