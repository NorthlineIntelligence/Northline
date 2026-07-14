import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { AssessmentKind } from "@prisma/client";

export type PortalRole = "NONE" | "PORTAL_USER" | "ORG_ADMIN";

export type ProcessAssessmentInvitesInput = {
  assessmentId: string;
  emails: string[];
  origin: string;
  expiresInHours?: number;
  portalRoleByEmail?: Record<string, PortalRole>;
};

export type ProcessedInvite = {
  email: string;
  participantId: string;
  inviteUrl: string;
  portalAccessUrl: string;
  portalRole: PortalRole;
  expiresAt: string;
};

export type ProcessAssessmentInvitesResult = {
  invited: number;
  invites: ProcessedInvite[];
  sent: number;
  failed: number;
  portalSent: number;
  portalFailed: number;
};

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function makeRawToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function buildInviteEmailHtml(args: {
  startUrl: string;
  assessmentType: AssessmentKind;
}) {
  const { startUrl, assessmentType } = args;
  const isPriority = assessmentType === "PRIORITY_DISCOVERY";
  const title = isPriority ? "Northline AI Priority Discovery" : "Northline AI Readiness";
  const intro = isPriority
    ? "You’ve been invited to participate in the AI Priority Discovery Assessment."
    : "You’ve been invited to participate in the AI Readiness Diagnostic.";
  const instructions = isPriority
    ? "This is a consultative assessment designed to identify the highest-value AI and automation opportunities across the organization. Your responses will help surface business pain points, workflow friction, decision bottlenecks, customer or employee impact, and areas where teams are aligned or misaligned on what should happen first."
    : "This assessment is anonymous and diagnostic — not performative. Please answer as honestly as possible; your input helps create an accurate snapshot of AI readiness and informs the most effective path forward.";
  const bullets = isPriority
    ? `
          <li>
            You will be asked a mix of open-ended, ranking, multiple-choice, and 1–5 scale questions.
          </li>
          <li>
            Focus on real problems: repeated manual work, slow handoffs, unclear decisions, reporting burden,
            customer friction, employee capacity issues, or initiatives leadership is already watching.
          </li>
          <li>
            Use plain language and practical examples. Short bullets are welcome. You do not need to know what the
            AI solution should be.
          </li>
          <li>
            If you suggest an AI or automation idea, describe the business problem it solves, what success would look
            like, what could go wrong, and who would need to be involved.
          </li>
          <li>
            The output will be an executive-ready Priority Discovery readout with a Top 5 AI Priority Projects list,
            supporting evidence, impact, risks, and recommended first steps.
          </li>
          <li>
            Recommendations are decision-support only. Northline and your leadership team will review the results
            before any project decision is made.
          </li>
        `
    : `
          <li>Select your department and seniority level to provide context for your responses.</li>
          <li>
            In the first free text field, list 1–2 word AI use cases relevant to your role
            (e.g., lead scoring, scheduling, reporting).
          </li>
          <li>
            Complete all 65 questions using a scale from 1 (Strongly Disagree) to 5 (Strongly Agree)
            based on your day-to-day experience.
          </li>
          <li>
            In the final free text field, describe areas in your daily work where AI could be helpful.
          </li>
        `;

  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; color:#0B1220; line-height:1.45">
      <div style="max-width: 640px; margin: 0 auto; padding: 24px;">
        <div style="font-size: 18px; font-weight: 800; color:#173464;">
          ${title}
        </div>

        <div style="margin-top: 14px; font-size: 14px;">
          ${intro}
        </div>

        <div style="margin-top: 14px; font-size: 14px; font-weight: 700; color:#173464;">
          ${isPriority ? "Priority Discovery Instructions" : "Assessment Instructions"}
        </div>
        <div style="margin-top: 8px; font-size: 14px; color:#0B1220; line-height:1.55;">
          ${instructions}
        </div>
        <ul style="margin-top: 8px; margin-bottom: 0; padding-left: 20px; font-size: 14px; color:#0B1220; line-height:1.55;">
          ${bullets}
        </ul>

        <div style="margin-top: 16px;">
          <a href="${startUrl}"
             style="display:inline-block; background:#173464; color:#ffffff; text-decoration:none; font-weight:800; padding:12px 16px; border-radius:12px;">
            ${isPriority ? "Start Priority Discovery" : "Start Assessment"}
          </a>
        </div>

        <div style="margin-top: 14px; font-size: 12px; color:#4B5565;">
          If the button doesn’t work, copy/paste this link:
          <div style="margin-top: 8px; padding: 10px; background:#F6F8FC; border:1px solid #E6EAF2; border-radius: 10px; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
            ${startUrl}
          </div>
        </div>

        <div style="margin-top: 18px; font-size: 12px; color:#4B5565;">
          ${
            isPriority
              ? "This assessment is designed to turn practical team input into executive clarity around where AI and automation can create the most value. Thanks for contributing."
              : "This assessment is designed for executive clarity — not busywork. Thanks for contributing."
          }
        </div>
      </div>
    </div>
    `;
}

export function buildPortalAccessEmailHtml(args: { accessUrl: string }) {
  const { accessUrl } = args;
  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; color:#0B1220; line-height:1.45">
      <div style="max-width: 640px; margin: 0 auto; padding: 24px;">
        <div style="font-size: 18px; font-weight: 800; color:#173464;">
          Northline Customer Portal Access
        </div>
        <div style="margin-top: 14px; font-size: 14px;">
          Your organization granted you access to the Northline customer portal.
        </div>
        <div style="margin-top: 16px;">
          <a href="${accessUrl}"
             style="display:inline-block; background:#173464; color:#ffffff; text-decoration:none; font-weight:800; padding:12px 16px; border-radius:12px;">
            Create Account Access
          </a>
        </div>
        <div style="margin-top: 14px; font-size: 12px; color:#4B5565;">
          You will receive one additional secure sign-in email to complete login.
        </div>
        <div style="margin-top: 8px; font-size: 12px; color:#4B5565;">
          Depending on your organization authentication settings, that email may be delivered by Supabase Auth.
        </div>
        <div style="margin-top: 12px; font-size: 12px; color:#4B5565;">
          If the button doesn’t work, copy/paste this link:
          <div style="margin-top: 8px; padding: 10px; background:#F6F8FC; border:1px solid #E6EAF2; border-radius: 10px; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
            ${accessUrl}
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function sendInviteEmail(args: { to: string; subject: string; html: string }) {
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

export function getInviteOrigin(fallbackOrigin: string) {
  return process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? fallbackOrigin;
}

export async function processAssessmentInvites(
  input: ProcessAssessmentInvitesInput
): Promise<ProcessAssessmentInvitesResult> {
  const assessment = await prisma.assessment.findUnique({
    where: { id: input.assessmentId },
    select: {
      id: true,
      organization_id: true,
      status: true,
      locked_at: true,
      assessment_type: true,
    },
  });

  if (!assessment) {
    throw new Error("Assessment not found");
  }

  const expiresInHours = input.expiresInHours ?? 168;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  const normalizedEmails = Array.from(
    new Set(input.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))
  );
  const portalRoleByEmail = input.portalRoleByEmail ?? {};
  const anyPortalAccessRequested = normalizedEmails.some((email) =>
    Object.prototype.hasOwnProperty.call(portalRoleByEmail, email)
      ? portalRoleByEmail[email] !== "NONE"
      : false
  );

  if ((assessment.locked_at != null || assessment.status === "CLOSED") && !anyPortalAccessRequested) {
    throw new Error("Assessment is locked/closed; cannot send new invites.");
  }

  const invites: ProcessedInvite[] = [];

  for (const email of normalizedEmails) {
    const hasPortalRoleOverride = Object.prototype.hasOwnProperty.call(portalRoleByEmail, email);
    const portalRole = portalRoleByEmail[email] ?? "NONE";
    const rawToken = makeRawToken();
    const tokenHash = sha256Hex(rawToken);

    const participant = await prisma.participant.upsert({
      where: {
        assessment_id_email: {
          assessment_id: input.assessmentId,
          email,
        },
      },
      create: {
        assessment_id: input.assessmentId,
        organization_id: assessment.organization_id,
        email,
        portal_role: portalRole,
        invite_token_hash: tokenHash,
        invite_token_expires_at: expiresAt,
        invite_sent_at: new Date(),
        invite_accepted_at: null,
      },
      update: {
        ...(hasPortalRoleOverride ? { portal_role: portalRole } : {}),
        invite_token_hash: tokenHash,
        invite_token_expires_at: expiresAt,
        invite_sent_at: new Date(),
      },
      select: { id: true, portal_role: true },
    });

    const inviteUrl =
      `${input.origin}/assessments/${input.assessmentId}${
        assessment.assessment_type === "PRIORITY_DISCOVERY" ? "" : "/start"
      }` +
      `?email=${encodeURIComponent(email)}` +
      `&token=${encodeURIComponent(rawToken)}`;

    const portalAccessUrl =
      `${input.origin}/customer/access` +
      `?assessmentId=${encodeURIComponent(input.assessmentId)}` +
      `&email=${encodeURIComponent(email)}`;

    invites.push({
      email,
      participantId: participant.id,
      inviteUrl,
      portalAccessUrl,
      portalRole: participant.portal_role as PortalRole,
      expiresAt: expiresAt.toISOString(),
    });

    if (participant.portal_role !== "NONE") {
      const existingContact = await prisma.orgContact.findFirst({
        where: {
          organization_id: assessment.organization_id,
          email,
        },
        select: { id: true },
      });
      if (!existingContact) {
        await prisma.orgContact.create({
          data: {
            organization_id: assessment.organization_id,
            email,
            name: email.split("@")[0] || email,
            title: participant.portal_role === "ORG_ADMIN" ? "Portal Admin" : "Portal User",
            is_archived: false,
          },
        });
      } else {
        await prisma.orgContact.update({
          where: { id: existingContact.id },
          data: { is_archived: false },
        });
      }
    }
  }

  let sent = 0;
  let failed = 0;
  let portalSent = 0;
  let portalFailed = 0;

  if (invites.length > 0) {
    const subject =
      assessment.assessment_type === "PRIORITY_DISCOVERY"
        ? "Northline AI Priority Discovery Assessment"
        : "Northline AI Readiness Diagnostic";

    await Promise.all(
      invites.map(async (inv) => {
        try {
          const html = buildInviteEmailHtml({
            startUrl: inv.inviteUrl,
            assessmentType: assessment.assessment_type,
          });
          await sendInviteEmail({ to: inv.email, subject, html });
          sent += 1;

          if (inv.portalRole !== "NONE") {
            const portalHtml = buildPortalAccessEmailHtml({ accessUrl: inv.portalAccessUrl });
            await sendInviteEmail({
              to: inv.email,
              subject: "Northline Customer Portal Account Access",
              html: portalHtml,
            });
            portalSent += 1;
          }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          if (inv.portalRole !== "NONE") {
            portalFailed += 1;
          } else {
            failed += 1;
          }
          console.error("Invite email failure:", inv.email, message);
        }
      })
    );
  }

  return {
    invited: invites.length,
    invites,
    sent,
    failed,
    portalSent,
    portalFailed,
  };
}
