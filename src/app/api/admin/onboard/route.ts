import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { Department, Industry, AssessmentAiProcessingMode } from "@prisma/client";
import { industryLabel, normalizeIndustryText } from "@/lib/assessmentIndustry";
import { anonymizeOrgText } from "@/lib/anonymizeOrgText";
import { ensureOrganizationDriveFolders } from "@/lib/googleDrive";
import { sendMakeLibraryEvent } from "@/lib/makeWebhook";
import { PRIORITY_DISCOVERY_SEED_QUESTIONS } from "@/lib/priorityDiscovery/questions";
import { Prisma } from "@prisma/client";
import { createScheduledInvite } from "@/lib/scheduledInvites";
import { getInviteOrigin, processAssessmentInvites } from "@/lib/assessmentInvites";
import { isValidTimezone } from "@/lib/scheduleTimezone";

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
    const knownTechStack = String(form.get("known_tech_stack") ?? "").trim();
    const knownIntegrations = String(form.get("known_integrations") ?? "").trim();
    const knownProcessWorkflows = String(form.get("known_process_workflows") ?? "").trim();

    const assessmentKindRaw = String(form.get("assessment_kind") ?? "readiness").trim();
    const assessmentKind =
      assessmentKindRaw === "priority_discovery" ? "PRIORITY_DISCOVERY" : "READINESS";
    const aiProcessingModeRaw = String(form.get("ai_processing_mode") ?? "executive").trim().toLowerCase();
    const aiProcessingMode =
      aiProcessingModeRaw === "fast"
        ? AssessmentAiProcessingMode.FAST
        : AssessmentAiProcessingMode.EXECUTIVE;
    const inviteSendMode = String(form.get("invite_send_mode") ?? "later").trim().toLowerCase();
    const inviteScheduledDate = String(form.get("invite_scheduled_date") ?? "").trim();
    const inviteScheduledTime = String(form.get("invite_scheduled_time") ?? "").trim();
    const inviteTimezone = String(form.get("invite_timezone") ?? "America/New_York").trim();
    const assessmentType = String(form.get("assessment_type") ?? "FULL").trim(); // FULL | DEPARTMENT
    const lockedDepartment = String(form.get("locked_department") ?? "").trim(); // Department enum value or ""

    const participantEmailsFromFields = (form.getAll("participant_email") as unknown[]).map((v) =>
      String(v ?? "").trim().toLowerCase()
    );
    const participantVisibilityRaw = (form.getAll("participant_can_view_executive_insights") as unknown[]).map(
      (v) => String(v ?? "").trim()
    );
    const participantUserAdminRaw = (form.getAll("participant_user_admin_rights") as unknown[]).map(
      (v) => String(v ?? "").trim()
    );
    const participantEntries = participantEmailsFromFields
      .map((email, idx) => ({
        email,
        can_view_executive_insights:
          (participantVisibilityRaw[idx] ?? "1").toLowerCase() !== "0",
        portal_role:
          (participantUserAdminRaw[idx] ?? "0").toLowerCase() === "1"
            ? ("ORG_ADMIN" as const)
            : ("NONE" as const),
      }))
      .filter((row) => row.email);
    const dedupedParticipantEntries: Array<{
      email: string;
      can_view_executive_insights: boolean;
      portal_role: "NONE" | "ORG_ADMIN";
    }> = [];
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

    if (assessmentKind === "READINESS" && assessmentType === "DEPARTMENT" && !lockedDepartment) {
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
      if (assessmentKind === "PRIORITY_DISCOVERY") {
        const existingPriorityQuestions = await tx.priorityQuestion.count({
          where: { assessment_type: "PRIORITY_DISCOVERY", question_set_version: "1" },
        });
        if (existingPriorityQuestions === 0) {
          await tx.priorityQuestion.createMany({
            data: PRIORITY_DISCOVERY_SEED_QUESTIONS.map((q) => ({
              assessment_type: "PRIORITY_DISCOVERY",
              question_set_version: "1",
              section: q.section,
              question_text: q.questionText,
              question_help_text: q.questionHelpText || null,
              response_type: q.responseType,
              options: (q.options ?? []) as Prisma.InputJsonValue,
              scale_min: q.scaleMin ?? null,
              scale_max: q.scaleMax ?? null,
              scale_labels: (q.scaleLabels ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              required: q.required,
              order: q.order,
              tags: (q.tags ?? []) as Prisma.InputJsonValue,
              scoring_dimension: q.scoringDimension ?? null,
              is_active: q.isActive,
            })),
          });
        }
      }

      const org = await tx.organization.create({
        data: {
          name,
          website: websiteRaw || null,
          industry: organizationIndustryLabel,
          context_notes: contextNotes || null,
          tech_stack_notes: knownTechStack || null,
          integration_notes: knownIntegrations || null,
          process_workflow_notes: knownProcessWorkflows || null,
        },
        select: { id: true, name: true },
      });

      const assessment = await tx.assessment.create({
        data: {
          organization_id: org.id,
          assessment_type: assessmentKind,
          question_set_version: "1",
          ai_processing_mode: aiProcessingMode,
          locked_department:
            assessmentKind === "READINESS" && assessmentType === "DEPARTMENT" ? (lockedDepartment as Department) : null,
          industry: (assessmentIndustry as Industry | null) ?? null,
          name:
            assessmentKind === "PRIORITY_DISCOVERY"
              ? "AI Priority Discovery Assessment"
              : "AI Readiness Assessment",
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
            portal_role: row.portal_role,
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

    let sent = 0;
    let failed = 0;
    let scheduled = false;
    let scheduledCount = 0;

    if (invitees.length > 0 && (inviteSendMode === "immediate" || inviteSendMode === "scheduled")) {
      const portalRoleByEmail = Object.fromEntries(
        invitees.map((row) => [row.email, row.portal_role === "ORG_ADMIN" ? "ORG_ADMIN" : "NONE"])
      ) as Record<string, "NONE" | "ORG_ADMIN">;

      if (inviteSendMode === "immediate") {
        try {
          const inviteResult = await processAssessmentInvites({
            assessmentId: result.assessmentId,
            emails: invitees.map((row) => row.email),
            origin: getInviteOrigin(req.nextUrl.origin),
            expiresInHours: 24 * 7,
            portalRoleByEmail,
          });
          sent = inviteResult.sent;
          failed = inviteResult.failed;
        } catch (err: unknown) {
          failed = invitees.length;
          console.error("Onboard immediate invite failure:", err);
        }
      } else if (inviteSendMode === "scheduled") {
        if (!inviteScheduledDate || !inviteScheduledTime || !isValidTimezone(inviteTimezone)) {
          return NextResponse.json(
            { error: "Bad Request", message: "Scheduled send requires date, time, and timezone." },
            { status: 400 }
          );
        }
        try {
          await createScheduledInvite({
            assessmentId: result.assessmentId,
            organizationId: result.orgId,
            emails: invitees.map((row) => row.email),
            portalRoleByEmail,
            expiresInHours: 24 * 7,
            localDate: inviteScheduledDate,
            localTime: inviteScheduledTime,
            timezone: inviteTimezone,
            createdByEmail: adminEmail,
          });
          scheduled = true;
          scheduledCount = invitees.length;
        } catch (err: unknown) {
          return NextResponse.json(
            {
              error: "Bad Request",
              message: err instanceof Error ? err.message : "Failed to schedule assessment invites.",
            },
            { status: 400 }
          );
        }
      }
    }

    try {
      await ensureOrganizationDriveFolders({
        organizationId: result.orgId,
        organizationName: result.orgName,
      });
    } catch {
      // best-effort Drive bootstrap
    }
    await sendMakeLibraryEvent({
      event_type: "organization_created",
      organization_id: result.orgId,
      organization_name: result.orgName,
      source_type: "ORG_BOOTSTRAP",
      source_id: result.orgId,
    });

    const orgUrl = new URL(`/admin/crm/organizations/${result.orgId}`, req.url);
    orgUrl.searchParams.set("created", "1");
    orgUrl.searchParams.set("invited", String(invitees.length));
    orgUrl.searchParams.set("sent", String(sent));
    orgUrl.searchParams.set("failed", String(failed));
    if (scheduled) {
      orgUrl.searchParams.set("scheduled", "1");
      orgUrl.searchParams.set("scheduledCount", String(scheduledCount));
      orgUrl.searchParams.set("scheduledAt", `${inviteScheduledDate} ${inviteScheduledTime}`);
      orgUrl.searchParams.set("scheduledTz", inviteTimezone);
    }
    return NextResponse.redirect(orgUrl, { status: 303 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Internal Server Error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}