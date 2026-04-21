import { NextRequest, NextResponse } from "next/server";
import { CrmMsaStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PatchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  status: z.nativeEnum(CrmMsaStatus).optional(),
  body_markdown: z.string().max(200000).optional(),
  terms_version: z.string().max(80).optional(),
  exhibit_a_snapshot_json: z.unknown().optional(),
  exhibit_b_snapshot_json: z.unknown().optional(),
  accepted_snapshot_text: z.string().max(200000).nullable().optional(),
  accepted_by_name: z.string().max(300).nullable().optional(),
  accepted_by_title: z.string().max(300).nullable().optional(),
  accepted_by_email: z.string().max(300).nullable().optional(),
  accepted_ip: z.string().max(120).nullable().optional(),
  accepted_at: z.string().datetime().nullable().optional(),
});

function renderAcceptedSnapshotText(args: {
  title: string;
  version_number: number;
  terms_version: string | null;
  body_markdown: string | null;
  exhibit_a_snapshot_json: unknown;
  exhibit_b_snapshot_json: unknown;
}) {
  return [
    `MSA: ${args.title}`,
    `Version: ${args.version_number}`,
    `Terms version: ${args.terms_version ?? "—"}`,
    "",
    "Body:",
    args.body_markdown ?? "",
    "",
    "Exhibit A:",
    JSON.stringify(args.exhibit_a_snapshot_json ?? null, null, 2),
    "",
    "Exhibit B:",
    JSON.stringify(args.exhibit_b_snapshot_json ?? null, null, 2),
  ].join("\n");
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  const msa = await prisma.crmMsa.findUnique({ where: { id: parsed.data.id } });
  if (!msa) return NextResponse.json({ ok: false, error: "MSA not found" }, { status: 404 });
  return NextResponse.json({ ok: true, msa });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const input = PatchSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const existing = await prisma.crmMsa.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return NextResponse.json({ ok: false, error: "MSA not found" }, { status: 404 });

  const wantsMutableChange =
    input.data.title !== undefined ||
    input.data.body_markdown !== undefined ||
    input.data.terms_version !== undefined ||
    input.data.exhibit_a_snapshot_json !== undefined ||
    input.data.exhibit_b_snapshot_json !== undefined;

  // Signed MSA is immutable: creating edits spawns a new versioned draft record.
  if (existing.status === CrmMsaStatus.SIGNED && wantsMutableChange) {
    const latestVersion = await prisma.crmMsa.findFirst({
      where: { organization_id: existing.organization_id },
      orderBy: { version_number: "desc" },
      select: { version_number: true },
    });
    const nextVersion = (latestVersion?.version_number ?? existing.version_number) + 1;

    const created = await prisma.crmMsa.create({
      data: {
        organization_id: existing.organization_id,
        source_quote_id: existing.source_quote_id,
        title: input.data.title?.trim() || existing.title,
        status: input.data.status && input.data.status !== CrmMsaStatus.SIGNED ? input.data.status : CrmMsaStatus.DRAFT,
        version_number: nextVersion,
        terms_version: input.data.terms_version?.trim() || existing.terms_version,
        body_markdown: input.data.body_markdown ?? existing.body_markdown,
        exhibit_a_snapshot_json:
          input.data.exhibit_a_snapshot_json && typeof input.data.exhibit_a_snapshot_json === "object"
            ? (input.data.exhibit_a_snapshot_json as object)
            : (existing.exhibit_a_snapshot_json ?? Prisma.JsonNull),
        exhibit_b_snapshot_json:
          input.data.exhibit_b_snapshot_json && typeof input.data.exhibit_b_snapshot_json === "object"
            ? (input.data.exhibit_b_snapshot_json as object)
            : (existing.exhibit_b_snapshot_json ?? Prisma.JsonNull),
      },
    });
    return NextResponse.json({
      ok: true,
      msa: created,
      version_bumped: true,
      message: "Signed MSA is immutable. Created new draft version.",
    });
  }

  const data: Parameters<typeof prisma.crmMsa.update>[0]["data"] = {};
  if (input.data.title !== undefined) data.title = input.data.title.trim();
  if (input.data.status !== undefined) data.status = input.data.status;
  if (input.data.body_markdown !== undefined) data.body_markdown = input.data.body_markdown;
  if (input.data.terms_version !== undefined) data.terms_version = input.data.terms_version.trim();
  if (input.data.exhibit_a_snapshot_json !== undefined) {
    data.exhibit_a_snapshot_json =
      input.data.exhibit_a_snapshot_json && typeof input.data.exhibit_a_snapshot_json === "object"
        ? (input.data.exhibit_a_snapshot_json as object)
        : Prisma.JsonNull;
  }
  if (input.data.exhibit_b_snapshot_json !== undefined) {
    data.exhibit_b_snapshot_json =
      input.data.exhibit_b_snapshot_json && typeof input.data.exhibit_b_snapshot_json === "object"
        ? (input.data.exhibit_b_snapshot_json as object)
        : Prisma.JsonNull;
  }
  if (input.data.accepted_snapshot_text !== undefined) data.accepted_snapshot_text = input.data.accepted_snapshot_text;
  if (input.data.accepted_by_name !== undefined) data.accepted_by_name = input.data.accepted_by_name;
  if (input.data.accepted_by_title !== undefined) data.accepted_by_title = input.data.accepted_by_title;
  if (input.data.accepted_by_email !== undefined) data.accepted_by_email = input.data.accepted_by_email;
  if (input.data.accepted_ip !== undefined) data.accepted_ip = input.data.accepted_ip;
  if (input.data.accepted_at !== undefined) {
    data.accepted_at = input.data.accepted_at ? new Date(input.data.accepted_at) : null;
  }

  // On transition to SIGNED, lock a full accepted snapshot automatically.
  const nextStatus = input.data.status ?? existing.status;
  if (nextStatus === CrmMsaStatus.SIGNED && existing.status !== CrmMsaStatus.SIGNED) {
    const nextBody = input.data.body_markdown ?? existing.body_markdown;
    const nextTitle = input.data.title?.trim() || existing.title;
    const nextTermsVersion = input.data.terms_version?.trim() || existing.terms_version;
    const nextExA =
      input.data.exhibit_a_snapshot_json !== undefined
        ? input.data.exhibit_a_snapshot_json
        : existing.exhibit_a_snapshot_json;
    const nextExB =
      input.data.exhibit_b_snapshot_json !== undefined
        ? input.data.exhibit_b_snapshot_json
        : existing.exhibit_b_snapshot_json;
    data.accepted_snapshot_text =
      input.data.accepted_snapshot_text ??
      renderAcceptedSnapshotText({
        title: nextTitle,
        version_number: existing.version_number,
        terms_version: nextTermsVersion,
        body_markdown: nextBody,
        exhibit_a_snapshot_json: nextExA,
        exhibit_b_snapshot_json: nextExB,
      });
    if (input.data.accepted_at === undefined) data.accepted_at = new Date();
  }

  const msa = await prisma.crmMsa.update({ where: { id: parsed.data.id }, data });
  return NextResponse.json({ ok: true, msa });
}

