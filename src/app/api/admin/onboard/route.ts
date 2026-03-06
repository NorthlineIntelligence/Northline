import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { createHash } from "crypto";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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
          // ignore (server components / edge cases)
        }
      },
    },
  });
}

function parseEmailList(raw: string | null): string[] {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of parts) {
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

function buildInviteEmailHtml(args: { orgName: string; startUrl: string }) {
  const { orgName, startUrl } = args;

  return `
  <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; color:#0B1220; line-height:1.45">
    <div style="max-width: 640px; margin: 0 auto; padding: 24px;">
      <div style="font-size: 18px; font-weight: 800; color:#173464;">
        Northline AI Readiness
      </div>

      <div style="margin-top: 14px; font-size: 14px;">
        You’ve been invited to participate in the <b>${orgName}</b> AI Readiness Diagnostic.
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

async function sendInviteEmail(args: {
    to: string;
    subject: string;
    html: string;
  }) {
    const apiKey = process.env.RESEND_API_KEY ?? "";
    const from = process.env.RESEND_FROM_EMAIL ?? "";
  
    console.log("[invite] about to send email", {
      to: args.to,
      assessmentId: "(not available in this function)",
      from,
      hasKey: Boolean(apiKey),
    });
  
    if (!apiKey || !from) {
      console.error("[invite] missing env vars", {
        hasKey: Boolean(apiKey),
        hasFrom: Boolean(from),
      });
  
      throw new Error("Missing RESEND_API_KEY or RESEND_FROM_EMAIL in environment variables.");
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
      console.error("[invite] resend error", {
        status: res.status,
        statusText: res.statusText,
        detail,
      });
      throw new Error(`Resend error (${res.status}): ${detail}`);
    }
  
    console.log("[invite] resend success", { to: args.to, status: res.status });
  }

export async function POST(req: NextRequest) {
  try {
    // --- AUTH GATE ---
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.redirect(new URL("/admin/login", req.url), {
        status: 303,
      });
    }

    const adminEmail = (user.email ?? "").trim().toLowerCase();
    if (!isAdminEmail(adminEmail)) {
      return NextResponse.redirect(
        new URL("/admin/login?error=forbidden", req.url),
        { status: 303 }
      );
    }
    // --- END AUTH GATE ---

    const form = await req.formData();

    const name = String(form.get("name") ?? "").trim();
    const websiteRaw = String(form.get("website") ?? "").trim();
    const industry = String(form.get("industry") ?? "").trim();
    const contextNotes = String(form.get("context_notes") ?? "").trim();

    const assessmentType = String(form.get("assessment_type") ?? "FULL").trim(); // FULL | DEPARTMENT
    const lockedDepartment = String(form.get("locked_department") ?? "").trim(); // Department enum value or ""

    const participantEmailsRaw = String(form.get("participant_emails") ?? "");
    const participantEmailsFromCsv = parseEmailList(participantEmailsRaw);

    const participantEmailsFromFields = (form.getAll(
      "participant_email"
    ) as unknown[])
      .map((v) => String(v ?? "").trim().toLowerCase())
      .filter(Boolean);

    const participantEmails = Array.from(
      new Set([...participantEmailsFromCsv, ...participantEmailsFromFields])
    );

    if (!name) {
      return NextResponse.json(
        { error: "Bad Request", message: "Organization name is required" },
        { status: 400 }
      );
    }

    if (assessmentType === "DEPARTMENT" && !lockedDepartment) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message: "locked_department is required when assessment_type=DEPARTMENT",
        },
        { status: 400 }
      );
    }

    const invitees = participantEmails.filter((e) => e !== adminEmail);

    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name,
          website: websiteRaw || null,
          industry: industry || null,
          context_notes: contextNotes || null,
        },
        select: { id: true, name: true },
      });

      const assessment = await tx.assessment.create({
        data: {
          organization_id: org.id,
          locked_department:
            assessmentType === "DEPARTMENT" ? (lockedDepartment as any) : null,
        },
        select: { id: true, organization_id: true },
      });

            // Ensure admin can see/manage it (membership row)
      // IMPORTANT: do NOT set Participant.email here, or the admin will appear as a "participant invitee"
      

      // Create invitee participants (email-only)
      if (invitees.length > 0) {
        await tx.participant.createMany({
          data: invitees.map((email) => ({
            organization_id: org.id,
            assessment_id: assessment.id,
            email,
          })),
          skipDuplicates: true,
        });
      }

      return { orgId: org.id, orgName: org.name, assessmentId: assessment.id };
    });

          // --- SEND EMAILS (after commit) ---
          const origin =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  new URL(req.url).origin;

          function startUrlFor(to: string) {
            return `${origin}/assessments/${result.assessmentId}/start?email=${encodeURIComponent(
              to
            )}&token=${encodeURIComponent((toToken.get(to) ?? ""))}`;
          }
    
          const toToken = new Map<string, string>();
    
          // Create a unique token per invitee and store its hash/expiry on their Participant row
          if (invitees.length > 0) {
            await Promise.all(
              invitees.map(async (to) => {
                const rawToken =
                  crypto.randomUUID().replaceAll("-", "") +
                  crypto.randomUUID().replaceAll("-", "");
                const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    
                toToken.set(to, rawToken);
    
                const inviteSentAt = new Date();
                const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
    
                await prisma.$executeRaw`
                  UPDATE "Participant"
                  SET
                    invite_token_hash = ${tokenHash},
                    invite_token_expires_at = ${inviteExpiresAt},
                    invite_sent_at = ${inviteSentAt}
                  WHERE
                    assessment_id = ${result.assessmentId}::uuid
                    AND email = ${to};
                `; 
              })
            );
          }
    
          let sentCount = 0;
          let failCount = 0;
    
    if (invitees.length > 0) {
      const subject = `Northline AI Readiness Diagnostic — ${result.orgName}`;
      await Promise.all(
        invitees.map(async (to) => {
            const startUrl = startUrlFor(to);
            console.log("[invite] startUrl", { to, startUrl });
            const html = buildInviteEmailHtml({
              orgName: result.orgName,
              startUrl,
            });
      
          try {
            await sendInviteEmail({ to, subject, html });
            sentCount += 1;
          } catch (e: any) {
            failCount += 1;
            console.error("Invite email failure:", to, e?.message ?? String(e));
          }
        })
      );
    }

    // Redirect to admin dashboard with send stats
    const dashUrl = new URL(`/admin/dashboard`, req.url);
    dashUrl.searchParams.set("created", "1");
    dashUrl.searchParams.set("invited", String(invitees.length));
    dashUrl.searchParams.set("sent", String(sentCount));
    dashUrl.searchParams.set("failed", String(failCount));

    return NextResponse.redirect(dashUrl, { status: 303 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Internal Server Error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}