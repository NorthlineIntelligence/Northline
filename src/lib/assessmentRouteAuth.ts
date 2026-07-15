import { NextRequest } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
        } catch {}
      },
    },
  });
}

/** Invite or Supabase user who is a participant on this assessment. */
export async function authorizeParticipantOrInvite(
  req: NextRequest,
  assessmentId: string,
  overrides?: { email?: string; token?: string }
) {
  const url = req.nextUrl;
  const email = (overrides?.email ?? url.searchParams.get("email") ?? "").trim().toLowerCase();
  const token = (overrides?.token ?? url.searchParams.get("token") ?? "").trim();

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
    return { ok: true as const, auth: "invite" as const, participantId: participant.id };
  }

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
      return {
        ok: true as const,
        auth: "admin" as const,
        userId: user.id,
        userEmail: user.email ?? null,
      };
    }
    return { ok: false as const };
  }

  return {
    ok: true as const,
    auth: "session" as const,
    participantId: membership.id,
    userEmail: user.email ?? null,
  };
}

/** Invite or session participant who may view Executive Insights. */
export async function authorizeExecutiveInsightsParticipant(
  req: NextRequest,
  assessmentId: string,
  overrides?: { email?: string; token?: string }
) {
  const auth = await authorizeParticipantOrInvite(req, assessmentId, overrides);
  if (!auth.ok) return { ok: false as const };

  if (auth.auth === "admin") {
    return { ok: true as const, auth: auth.auth, participantId: null, userEmail: auth.userEmail };
  }

  const participantId = auth.auth === "invite" || auth.auth === "session" ? auth.participantId : null;
  if (!participantId) return { ok: false as const };

  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { id: true, can_view_executive_insights: true, email: true },
  });
  if (!participant?.can_view_executive_insights) return { ok: false as const };

  return {
    ok: true as const,
    auth: auth.auth,
    participantId: participant.id,
    userEmail: participant.email,
  };
}

export async function allParticipantsCompleted(assessmentId: string) {
  const rows = await prisma.$queryRaw<Array<{ completed_at: Date | null }>>`
    SELECT completed_at
    FROM "Participant"
    WHERE assessment_id = ${assessmentId}::uuid
      AND email IS NOT NULL;
  `;

  const total = rows.length;
  const completed = rows.filter((p) => p.completed_at != null).length;

  return {
    total,
    completed,
    ok: total > 0 && completed >= total,
  };
}

export async function markInviteAccepted(participantId: string) {
  await prisma.$executeRaw`
    UPDATE "Participant"
    SET invite_accepted_at = COALESCE(invite_accepted_at, NOW())
    WHERE id = ${participantId}::uuid;
  `;
}
