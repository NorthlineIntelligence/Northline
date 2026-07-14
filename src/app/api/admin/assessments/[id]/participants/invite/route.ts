// src/app/api/admin/assessments/[id]/participants/invite/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAdminEmail } from "@/lib/admin";
import {
  getInviteOrigin,
  processAssessmentInvites,
} from "@/lib/assessmentInvites";
import { createScheduledInvite } from "@/lib/scheduledInvites";
import { isValidTimezone } from "@/lib/scheduleTimezone";

const ParamsSchema = z.object({ id: z.string().uuid() });

const BodySchema = z
  .object({
    emails: z.array(z.string().email()).min(1).max(100),
    expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
    portalRoleByEmail: z
      .record(z.string().email(), z.enum(["NONE", "PORTAL_USER", "ORG_ADMIN"]))
      .optional(),
    sendMode: z.enum(["immediate", "scheduled"]).default("immediate"),
    scheduledLocalDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    scheduledLocalTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    timezone: z.string().min(1).max(80).optional(),
  })
  .strict();

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

function getOrigin(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

async function assertAdmin(req: NextRequest) {
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
    return { ok: false as const, status: 401 as const, error: "Unauthorized" as const };
  }

  const email = user.email ?? null;
  if (!isAdminEmail(email)) {
    return { ok: false as const, status: 403 as const, error: "Forbidden" as const };
  }

  return { ok: true as const, mode: "session" as const, email: email ?? "unknown" };
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await assertAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    const params = await context.params;
    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }
    const assessmentId = parsedParams.data.id;

    const body = await req.json().catch(() => null);
    const parsedBody = BodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid body", issues: parsedBody.error.issues },
        { status: 400 }
      );
    }

    const expiresInHours = parsedBody.data.expiresInHours ?? 168;
    const normalizedEmails = Array.from(
      new Set(parsedBody.data.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    );
    const portalRoleByEmail = parsedBody.data.portalRoleByEmail ?? {};
    const anyPortalAccessRequested = normalizedEmails.some((email) =>
      Object.prototype.hasOwnProperty.call(portalRoleByEmail, email)
        ? portalRoleByEmail[email] !== "NONE"
        : false
    );

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        organization_id: true,
        status: true,
        locked_at: true,
        assessment_type: true,
      },
    });

    if (!assessment) {
      return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
    }

    if ((assessment.locked_at != null || assessment.status === "CLOSED") && !anyPortalAccessRequested) {
      return NextResponse.json(
        { ok: false, error: "Assessment is locked/closed; cannot send new invites." },
        { status: 409 }
      );
    }

    if (parsedBody.data.sendMode === "scheduled") {
      const { scheduledLocalDate, scheduledLocalTime, timezone } = parsedBody.data;
      if (!scheduledLocalDate || !scheduledLocalTime || !timezone) {
        return NextResponse.json(
          { ok: false, error: "Scheduled send requires date, time, and timezone." },
          { status: 400 }
        );
      }
      if (!isValidTimezone(timezone)) {
        return NextResponse.json({ ok: false, error: "Invalid timezone." }, { status: 400 });
      }

      const schedule = await createScheduledInvite({
        assessmentId,
        organizationId: assessment.organization_id,
        emails: normalizedEmails,
        portalRoleByEmail,
        expiresInHours,
        localDate: scheduledLocalDate,
        localTime: scheduledLocalTime,
        timezone,
        createdByEmail: admin.email,
      });

      return NextResponse.json(
        {
          ok: true,
          scheduled: true,
          schedule,
          invited: normalizedEmails.length,
          mode: admin.mode,
        },
        { status: 201 }
      );
    }

    const origin = getInviteOrigin(getOrigin(req));
    const result = await processAssessmentInvites({
      assessmentId,
      emails: normalizedEmails,
      origin,
      expiresInHours,
      portalRoleByEmail,
    });

    return NextResponse.json(
      {
        ok: true,
        scheduled: false,
        invited: result.invited,
        invites: result.invites,
        sent: result.sent,
        failed: result.failed,
        portalSent: result.portalSent,
        portalFailed: result.portalFailed,
        mode: admin.mode,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("POST invite error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message || "Internal server error." },
      { status: 500 }
    );
  }
}
