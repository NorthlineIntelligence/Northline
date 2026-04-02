// src/app/api/assessments/[id]/participant/route.ts
import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createHash } from "crypto";
import { Department } from "@prisma/client";

const ParamsSchema = z.object({ id: z.string().uuid() });

const BodySchema = z
  .object({
    // Invite-link fallback (for users not logged into Supabase yet)
    email: z.string().email().optional().nullable(),
    token: z.string().min(1).optional().nullable(),

    // Optional fields
    department: z.nativeEnum(Department).optional().nullable(),
    seniority_level: z.string().min(1).max(120).optional().nullable(),
    role: z.string().min(1).max(200).optional().nullable(),
    ai_opportunities_notes: z.string().min(1).max(5000).optional().nullable(),
  })
  .strict();

/**
 * ✅ REQUIRED: exactly one server client helper.
 */
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

/**
 * Your Prisma TS types are currently out of sync with DB columns (email/invite fields/locked_at).
 * To eliminate TS errors AND keep features working, we use raw SQL for:
 * - Participant.email, invite_token_expires_at, invite_accepted_at
 * - Assessment.locked_at
 */
type AssessmentRow = {
  id: string;
  organization_id: string;
  status: string;
  locked_at: Date | null;
  locked_department: Department | null;
};

type ParticipantRow = {
  id: string;
  assessment_id: string;
  organization_id: string;
  user_id: string | null;
  email: string | null;
  department: Department | null;
  role: string | null;
  seniority_level: string | null;
  ai_opportunities_notes: string | null;
  created_at: Date;
  invite_accepted_at: Date | null;
};

async function getAssessment(assessmentId: string): Promise<AssessmentRow | null> {
  const rows = await prisma.$queryRaw<AssessmentRow[]>`
    SELECT
      id,
      organization_id,
      status,
      locked_at,
      locked_department
    FROM "Assessment"
    WHERE id = ${assessmentId}::uuid
    LIMIT 1;
  `;
  return rows?.[0] ?? null;
}

function isAssessmentLocked(a: AssessmentRow) {
  // Preserve your prior behavior: block NEW joins when locked_at set OR status !== DRAFT
  return a.locked_at != null || String(a.status) !== "DRAFT";
}

async function getParticipantByAssessmentAndUser(args: {
  assessmentId: string;
  userId: string;
}): Promise<ParticipantRow | null> {
  const rows = await prisma.$queryRaw<ParticipantRow[]>`
    SELECT
      id,
      assessment_id,
      organization_id,
      user_id,
      email,
      department,
      role,
      seniority_level,
      ai_opportunities_notes,
      created_at,
      invite_accepted_at
    FROM "Participant"
    WHERE assessment_id = ${args.assessmentId}::uuid
      AND user_id = ${args.userId}::uuid
    LIMIT 1;
  `;
  return rows?.[0] ?? null;
}

async function createParticipantForUser(args: {
  assessmentId: string;
  organizationId: string;
  userId: string;
}): Promise<ParticipantRow> {
  const rows = await prisma.$queryRaw<ParticipantRow[]>`
    INSERT INTO "Participant" (assessment_id, organization_id, user_id)
    VALUES (${args.assessmentId}::uuid, ${args.organizationId}::uuid, ${args.userId}::uuid)
    RETURNING
      id,
      assessment_id,
      organization_id,
      user_id,
      email,
      department,
      role,
      seniority_level,
      ai_opportunities_notes,
      created_at,
      invite_accepted_at;
  `;
  const row = rows?.[0];
  if (!row) throw new Error("Failed to create participant.");
  return row;
}

async function ensureParticipantForUser(assessmentId: string, userId: string) {
  const assessment = await getAssessment(assessmentId);
  if (!assessment) {
    return { ok: false as const, status: 404 as const, error: "Assessment not found" };
  }

  const existing = await getParticipantByAssessmentAndUser({ assessmentId, userId });
  if (existing) {
    return {
      ok: true as const,
      status: 200 as const,
      participant: existing,
      reused: true as const,
      assessment,
    };
  }

  if (isAssessmentLocked(assessment)) {
    return {
      ok: false as const,
      status: 403 as const,
      error: "Assessment is locked; no new participants can join.",
      assessment,
    };
  }

  try {
    const created = await createParticipantForUser({
      assessmentId,
      organizationId: assessment.organization_id,
      userId,
    });

    return {
      ok: true as const,
      status: 201 as const,
      participant: created,
      reused: false as const,
      assessment,
    };
  } catch (err: any) {
    // handle race: if unique constraint exists in DB, retry select
    const again = await getParticipantByAssessmentAndUser({ assessmentId, userId });
    if (again) {
      return {
        ok: true as const,
        status: 200 as const,
        participant: again,
        reused: true as const,
        assessment,
      };
    }
    throw err;
  }
}

async function getParticipantByInvite(args: {
  assessmentId: string;
  email: string;
  tokenHash: string;
}): Promise<ParticipantRow | null> {
  const email = args.email.trim().toLowerCase();
  const rows = await prisma.$queryRaw<ParticipantRow[]>`
    SELECT
      id,
      assessment_id,
      organization_id,
      user_id,
      email,
      department,
      role,
      seniority_level,
      ai_opportunities_notes,
      created_at,
      invite_accepted_at
    FROM "Participant"
    WHERE assessment_id = ${args.assessmentId}::uuid
      AND lower(email) = ${email}
      AND invite_token_hash = ${args.tokenHash}
      AND (invite_token_expires_at IS NULL OR invite_token_expires_at > NOW())
    LIMIT 1;
  `;
  return rows?.[0] ?? null;
}

async function markInviteAcceptedIfMissing(participantId: string) {
  await prisma.$executeRaw`
    UPDATE "Participant"
    SET invite_accepted_at = COALESCE(invite_accepted_at, NOW())
    WHERE id = ${participantId}::uuid;
  `;
}

async function updateParticipantFields(args: {
  participantId: string;
  department?: Department | null;
  seniority_level?: string | null;
  role?: string | null;
  ai_opportunities_notes?: string | null;
}): Promise<ParticipantRow> {
  const rows = await prisma.$queryRaw<ParticipantRow[]>`
    UPDATE "Participant"
    SET
      department = COALESCE(${args.department}::"Department", department),
      seniority_level = COALESCE(${args.seniority_level}, seniority_level),
      role = COALESCE(${args.role}, role),
      ai_opportunities_notes = COALESCE(${args.ai_opportunities_notes}, ai_opportunities_notes)
    WHERE id = ${args.participantId}::uuid
    RETURNING
      id,
      assessment_id,
      organization_id,
      user_id,
      email,
      department,
      role,
      seniority_level,
      ai_opportunities_notes,
      created_at,
      invite_accepted_at;
  `;
  const row = rows?.[0];
  if (!row) throw new Error("Failed to update participant.");
  return row;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid assessment id (UUID)" },
        { status: 400 }
      );
    }
    const assessmentId = parsed.data.id;

    const ct = req.headers.get("content-type") ?? "";
    const bodyJson = ct.includes("application/json") ? await req.json().catch(() => null) : null;
    const bodyParsed = bodyJson ? BodySchema.safeParse(bodyJson) : null;

    if (bodyParsed && !bodyParsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid body", issues: bodyParsed.error.issues },
        { status: 400 }
      );
    }

    const desiredDepartment =
      bodyParsed?.success ? (bodyParsed.data.department ?? undefined) : undefined;

    if (desiredDepartment === Department.ALL) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid department",
          message:
            'Choose your current department or team for reporting. Org-wide (ALL) is not used as a participant department.',
        },
        { status: 400 }
      );
    }

    const emailFromBody =
      bodyParsed?.success && bodyParsed.data.email
        ? bodyParsed.data.email.trim().toLowerCase()
        : null;

    const tokenFromBody =
      bodyParsed?.success && bodyParsed.data.token ? bodyParsed.data.token.trim() : null;

    const seniorityFromBody =
      bodyParsed?.success ? (bodyParsed.data.seniority_level ?? undefined) : undefined;

    const roleFromBody =
      bodyParsed?.success ? (bodyParsed.data.role ?? undefined) : undefined;

    const aiNotesFromBody =
      bodyParsed?.success ? (bodyParsed.data.ai_opportunities_notes ?? undefined) : undefined;

    // 1) Supabase session path (admin/user logged in)
    const supabase = await getSupabaseServerClient();
    const { data, error: userError } = await supabase.auth.getUser();
    const user = data?.user ?? null;

    if (!userError && user?.id) {
      const ensured = await ensureParticipantForUser(assessmentId, user.id);
      if (!ensured.ok) {
        return NextResponse.json({ ok: false, error: ensured.error }, { status: ensured.status });
      }

      const assessment = ensured.assessment;

      // If assessment is locked/closed, prevent department changes
      const assessmentClosed = isAssessmentLocked(assessment);
      if (assessmentClosed && desiredDepartment !== undefined) {
        return NextResponse.json(
          { ok: false, error: "Assessment is locked. Department can no longer be changed." },
          { status: 409 }
        );
      }

      // Enforce locked_department if present
      if (desiredDepartment != null && assessment.locked_department) {
        if (desiredDepartment !== assessment.locked_department) {
          return NextResponse.json(
            {
              ok: false,
              error: "Assessment is locked to a department",
              locked_department: assessment.locked_department,
            },
            { status: 409 }
          );
        }
      }

      let participant = ensured.participant;

      const wantsAnyUpdate =
        desiredDepartment !== undefined ||
        seniorityFromBody !== undefined ||
        roleFromBody !== undefined ||
        aiNotesFromBody !== undefined;

      if (wantsAnyUpdate) {
        participant = await updateParticipantFields({
          participantId: participant.id,
          // only set if provided; if not provided, pass undefined so COALESCE keeps current
          department: desiredDepartment !== undefined ? (desiredDepartment ?? null) : undefined,
          seniority_level: seniorityFromBody !== undefined ? (seniorityFromBody ?? null) : undefined,
          role: roleFromBody !== undefined ? (roleFromBody ?? null) : undefined,
          ai_opportunities_notes: aiNotesFromBody !== undefined ? (aiNotesFromBody ?? null) : undefined,
        });
      }

      return NextResponse.json(
        { ok: true, participant, reused: ensured.reused, assessment: { locked_department: assessment.locked_department, status: assessment.status, locked_at: assessment.locked_at } },
        { status: ensured.status }
      );
    }

    // 2) Invite-link path (email + token required)
    if (!emailFromBody || !tokenFromBody) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", message: "No session found. Provide email and token." },
        { status: 401 }
      );
    }

    const tokenHash = createHash("sha256").update(tokenFromBody).digest("hex");

    const participant = await getParticipantByInvite({
      assessmentId,
      email: emailFromBody,
      tokenHash,
    });

    if (!participant) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", message: "Invalid or expired invite link." },
        { status: 401 }
      );
    }

    // Enforce locked_department if present (invite flow too)
    const assessment = await getAssessment(assessmentId);
    if (!assessment) {
      return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
    }

    if (desiredDepartment != null && assessment.locked_department) {
      if (desiredDepartment !== assessment.locked_department) {
        return NextResponse.json(
          {
            ok: false,
            error: "Assessment is locked to a department",
            locked_department: assessment.locked_department,
          },
          { status: 409 }
        );
      }
    }

    await markInviteAcceptedIfMissing(participant.id);

    const wantsAnyUpdate =
      desiredDepartment !== undefined ||
      seniorityFromBody !== undefined ||
      roleFromBody !== undefined ||
      aiNotesFromBody !== undefined;

    const finalParticipant = wantsAnyUpdate
      ? await updateParticipantFields({
          participantId: participant.id,
          department: desiredDepartment !== undefined ? (desiredDepartment ?? null) : undefined,
          seniority_level: seniorityFromBody !== undefined ? (seniorityFromBody ?? null) : undefined,
          role: roleFromBody !== undefined ? (roleFromBody ?? null) : undefined,
          ai_opportunities_notes: aiNotesFromBody !== undefined ? (aiNotesFromBody ?? null) : undefined,
        })
      : participant;

    return NextResponse.json(
      { ok: true, participant: finalParticipant, reused: true, assessment: { locked_department: assessment.locked_department, status: assessment.status, locked_at: assessment.locked_at } },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/assessments/[id]/participant error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}