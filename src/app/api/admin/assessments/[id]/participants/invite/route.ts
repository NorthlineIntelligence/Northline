// src/app/api/admin/assessments/[id]/participants/invite/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAdminEmail } from "@/lib/admin";

const ParamsSchema = z.object({ id: z.string().uuid() });

const BodySchema = z
  .object({
    emails: z.array(z.string().email()).min(1).max(100),
    expiresInHours: z.number().int().min(1).max(24 * 30).optional(), // up to 30 days
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

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function makeRawToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function getOrigin(req: NextRequest) {
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) return `${proto}://${host}`;
    return req.nextUrl.origin;
  }
  
  function buildInviteEmailHtml(args: { startUrl: string }) {
    const { startUrl } = args;
  
    return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; color:#0B1220; line-height:1.45">
      <div style="max-width: 640px; margin: 0 auto; padding: 24px;">
        <div style="font-size: 18px; font-weight: 800; color:#173464;">
          Northline AI Readiness
        </div>
  
        <div style="margin-top: 14px; font-size: 14px;">
          You’ve been invited to participate in the AI Readiness Diagnostic.
        </div>
  
        <div style="margin-top: 16px;">
          <a href="${startUrl}"
             style="display:inline-block; background:#173464; color:#ffffff; text-decoration:none; font-weight:800; padding:12px 16px; border-radius:12px;">
            Start Assessment
          </a>
        </div>
  
        <div style="margin-top: 14px; font-size: 12px; color:#4B5565;">
          If the button doesn’t work, copy/paste this link:
          <div style="margin-top: 8px; padding: 10px; background:#F6F8FC; border:1px solid #E6EAF2; border-radius: 10px; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
            ${startUrl}
          </div>
        </div>
  
        <div style="margin-top: 18px; font-size: 12px; color:#4B5565;">
          This diagnostic is designed for executive clarity — not busywork. Thanks for contributing.
        </div>
      </div>
    </div>
    `;
  }
  
  async function sendInviteEmail(args: { to: string; subject: string; html: string }) {
    const apiKey = process.env.RESEND_API_KEY ?? "";
    const from = process.env.RESEND_FROM_EMAIL ?? "";
  
    if (!apiKey || !from) {
      throw new Error("Missing RESEND_API_KEY or RESEND_FROM_EMAIL environment variables.");
    }
  
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
      }),
    });
  
    const detail = await res.text().catch(() => "");
  
    if (!res.ok) {
      throw new Error(`Resend error (${res.status}): ${detail}`);
    }
  }

async function assertAdmin(req: NextRequest) {
  // DEV BYPASS: lets you curl locally without needing a browser session cookie
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
    // ---- auth ----
    const admin = await assertAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    // ---- params ----
    const params = await context.params;
    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }
    const assessmentId = parsedParams.data.id;

    // ---- body ----
    const body = await req.json().catch(() => null);
    const parsedBody = BodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid body", issues: parsedBody.error.issues },
        { status: 400 }
      );
    }

    const expiresInHours = parsedBody.data.expiresInHours ?? 168;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const normalizedEmails = Array.from(
      new Set(parsedBody.data.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    );

    // ---- assessment ----
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        organization_id: true,
        status: true,
        locked_at: true,
      },
    });

    if (!assessment) {
      return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
    }

    // Prevent inviting into closed/locked assessments
    if (assessment.locked_at != null || assessment.status === "CLOSED") {
      return NextResponse.json(
        { ok: false, error: "Assessment is locked/closed; cannot send new invites." },
        { status: 409 }
      );
    }

    const origin = getOrigin(req);

    const invites: Array<{
      email: string;
      participantId: string;
      inviteUrl: string;
      expiresAt: string;
    }> = [];

    for (const email of normalizedEmails) {
      const rawToken = makeRawToken();
      const tokenHash = sha256Hex(rawToken);

      // ✅ IMPORTANT: Prisma Client compound unique key name is assessment_id_email
      const participant = await prisma.participant.upsert({
        where: {
          assessment_id_email: {
            assessment_id: assessmentId,
            email,
          },
        },
        create: {
          assessment_id: assessmentId,
          organization_id: assessment.organization_id,
          email,
          invite_token_hash: tokenHash,
          invite_token_expires_at: expiresAt,
          invite_sent_at: new Date(),
          invite_accepted_at: null,
        },
        update: {
          invite_token_hash: tokenHash,
          invite_token_expires_at: expiresAt,
          invite_sent_at: new Date(),
          // do NOT wipe invite_accepted_at
        },
        select: { id: true },
      });

      const inviteUrl =
        `${origin}/assessments/${assessmentId}` +
        `?email=${encodeURIComponent(email)}` +
        `&token=${encodeURIComponent(rawToken)}`;

      invites.push({
        email,
        participantId: participant.id,
        inviteUrl,
        expiresAt: expiresAt.toISOString(),
      });
    }

    let sent = 0;
    let failed = 0;

    if (invites.length > 0) {
      const subject = `Northline AI Readiness Diagnostic`;

      await Promise.all(
        invites.map(async (inv) => {
          try {
            const html = buildInviteEmailHtml({ startUrl: inv.inviteUrl });
            await sendInviteEmail({ to: inv.email, subject, html });
            sent += 1;
          } catch (e: any) {
            failed += 1;
            console.error("Invite email failure:", inv.email, e?.message ?? String(e));
          }
        })
      );
    }

    return NextResponse.json(
      { ok: true, invited: invites.length, invites, sent, failed, mode: admin.mode },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST invite error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}