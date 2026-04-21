import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { createHash } from "crypto";
import { Industry } from "@prisma/client";
import { industryLabel, normalizeIndustryText } from "@/lib/assessmentIndustry";
import { anonymizeOrgText } from "@/lib/anonymizeOrgText";

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

const MAX_FILES = 10;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 120000;

function normalizeTextForExtraction(text: string): string | null {
  const trimmed = text.replace(/\u0000/g, "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

function canExtractText(mimeType: string, name: string): boolean {
  const mt = (mimeType || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (mt.startsWith("text/")) return true;
  if (mt === "application/json") return true;
  return (
    n.endsWith(".txt") ||
    n.endsWith(".md") ||
    n.endsWith(".csv") ||
    n.endsWith(".json") ||
    n.endsWith(".log")
  );
}

async function extractTextFromFile(file: File, mime: string | null): Promise<string | null> {
  const name = file.name.toLowerCase();
  const mt = (mime ?? "").toLowerCase();

  if (mt === "application/pdf" || name.endsWith(".pdf")) {
    const mod = await import("pdf-parse");
    const PDFParse = mod.PDFParse;
    const ab = await file.arrayBuffer();
    const parser = new PDFParse({ data: Buffer.from(ab) });
    try {
      const parsed = await parser.getText();
      return normalizeTextForExtraction(parsed?.text ?? "");
    } finally {
      await parser.destroy();
    }
  }

  if (canExtractText(mt, name)) {
    return normalizeTextForExtraction(await file.text());
  }
  return null;
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
    const industryRaw = String(form.get("industry") ?? "").trim();
    const assessmentIndustryRaw = String(form.get("assessment_industry") ?? "").trim();
    const contextNotes = String(form.get("context_notes") ?? "").trim();

    const assessmentType = String(form.get("assessment_type") ?? "FULL").trim(); // FULL | DEPARTMENT
    const lockedDepartment = String(form.get("locked_department") ?? "").trim(); // Department enum value or ""

    const participantEmailsFromFields = (form.getAll("participant_email") as unknown[]).map((v) =>
      String(v ?? "").trim().toLowerCase()
    );
    const participantVisibilityRaw = (form.getAll("participant_can_view_executive_insights") as unknown[]).map(
      (v) => String(v ?? "").trim()
    );
    const participantEntries = participantEmailsFromFields
      .map((email, idx) => ({
        email,
        can_view_executive_insights:
          (participantVisibilityRaw[idx] ?? "1").toLowerCase() !== "0",
      }))
      .filter((row) => row.email);
    const dedupedParticipantEntries: Array<{ email: string; can_view_executive_insights: boolean }> = [];
    const seen = new Set<string>();
    for (const row of participantEntries) {
      if (seen.has(row.email)) continue;
      seen.add(row.email);
      dedupedParticipantEntries.push(row);
    }
    const uploadFiles = form
      .getAll("documents")
      .filter((x): x is File => x instanceof File && x.size > 0);

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
    if (uploadFiles.length > MAX_FILES) {
      return NextResponse.json(
        { error: "Bad Request", message: `Too many documents. Max ${MAX_FILES}.` },
        { status: 400 }
      );
    }
    for (const f of uploadFiles) {
      if (f.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          {
            error: "Bad Request",
            message: `File "${f.name}" exceeds ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
          },
          { status: 400 }
        );
      }
    }

    const normalizedOrgIndustry =
      normalizeIndustryText(industryRaw) ?? normalizeIndustryText(assessmentIndustryRaw);
    const organizationIndustryLabel =
      normalizedOrgIndustry && normalizedOrgIndustry !== "ALL_INDUSTRIES"
        ? ((industryLabel(normalizedOrgIndustry) ?? industryRaw) || null)
        : null;
    const assessmentIndustry =
      normalizeIndustryText(assessmentIndustryRaw) ??
      normalizeIndustryText(industryRaw) ??
      null;

    const invitees = dedupedParticipantEntries.filter((e) => e.email !== adminEmail);

    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name,
          website: websiteRaw || null,
          industry: organizationIndustryLabel,
          context_notes: contextNotes || null,
        },
        select: { id: true, name: true },
      });

      const assessment = await tx.assessment.create({
        data: {
          organization_id: org.id,
          locked_department:
            assessmentType === "DEPARTMENT" ? (lockedDepartment as any) : null,
          industry: (assessmentIndustry as Industry | null) ?? null,
        },
        select: { id: true, organization_id: true },
      });

            // Ensure admin can see/manage it (membership row)
      // IMPORTANT: do NOT set Participant.email here, or the admin will appear as a "participant invitee"
      

      // Create invitee participants (email-only)
      if (invitees.length > 0) {
        await tx.participant.createMany({
          data: invitees.map((row) => ({
            organization_id: org.id,
            assessment_id: assessment.id,
            email: row.email,
            can_view_executive_insights: row.can_view_executive_insights,
          })),
          skipDuplicates: true,
        });
      }

      if (uploadFiles.length > 0) {
        for (const file of uploadFiles) {
          const mime = file.type?.trim() || null;
          let extractedText: string | null = null;
          let note: string | null = null;
          try {
            extractedText = await extractTextFromFile(file, mime);
            extractedText = anonymizeOrgText({
              text: extractedText,
              organizationName: name,
              industry: organizationIndustryLabel,
            });
            if (!extractedText) {
              note = "No usable text could be extracted from this file.";
            }
          } catch {
            note = "Could not extract text from this file.";
          }

          if (
            !extractedText &&
            !(mime?.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))
          ) {
            note =
              note ??
              "Uploaded metadata only. For AI grounding, upload text/markdown/csv/json/log or PDF files.";
          }

          await tx.organizationDocument.create({
            data: {
              organization_id: org.id,
              title: file.name,
              source_type: "UPLOAD",
              source_url: note,
              mime_type: mime,
              text_extracted: extractedText,
            },
          });
        }
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
        invitees.map(async (entry) => {
          const to = entry.email;
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
        invitees.map(async (entry) => {
            const to = entry.email;
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