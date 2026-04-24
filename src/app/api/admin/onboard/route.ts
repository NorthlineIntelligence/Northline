import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { Department, Industry } from "@prisma/client";
import { industryLabel, normalizeIndustryText } from "@/lib/assessmentIndustry";
import { anonymizeOrgText } from "@/lib/anonymizeOrgText";
import { ensureOrganizationDriveFolders } from "@/lib/googleDrive";
import { sendMakeLibraryEvent } from "@/lib/makeWebhook";

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
          tech_stack_notes: knownTechStack || null,
          integration_notes: knownIntegrations || null,
          process_workflow_notes: knownProcessWorkflows || null,
        },
        select: { id: true, name: true },
      });

      const assessment = await tx.assessment.create({
        data: {
          organization_id: org.id,
          locked_department:
            assessmentType === "DEPARTMENT" ? (lockedDepartment as Department) : null,
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

    // Do not auto-send invites on intake create. Save participants only.
    const orgUrl = new URL(`/admin/organizations/${result.orgId}`, req.url);
    orgUrl.searchParams.set("created", "1");
    orgUrl.searchParams.set("invited", String(invitees.length));
    orgUrl.searchParams.set("sent", "0");
    orgUrl.searchParams.set("failed", "0");
    return NextResponse.redirect(orgUrl, { status: 303 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Internal Server Error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}