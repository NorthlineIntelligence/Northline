import { NextRequest, NextResponse } from "next/server";
import { CrmMsaStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PostSchema = z.object({
  title: z.string().min(1).max(500),
  source_quote_id: z.string().uuid().optional(),
  terms_version: z.string().max(80).optional(),
  body_markdown: z.string().max(200000).optional(),
  exhibit_a_snapshot_json: z.unknown().optional(),
  exhibit_b_snapshot_json: z.unknown().optional(),
});

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id." }, { status: 400 });
  }

  const msas = await prisma.crmMsa.findMany({
    where: { organization_id: parsed.data.id },
    orderBy: [{ updated_at: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      version_number: true,
      terms_version: true,
      source_quote_id: true,
      accepted_by_name: true,
      accepted_by_email: true,
      accepted_at: true,
      updated_at: true,
      created_at: true,
    },
  });

  return NextResponse.json({ ok: true, msas });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id." }, { status: 400 });
  }
  const organizationId = parsed.data.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const input = PostSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const msa = await prisma.crmMsa.create({
    data: {
      organization_id: organizationId,
      source_quote_id: input.data.source_quote_id ?? null,
      title: input.data.title.trim(),
      status: CrmMsaStatus.DRAFT,
      terms_version: input.data.terms_version?.trim() || null,
      body_markdown: input.data.body_markdown || null,
      exhibit_a_snapshot_json:
        input.data.exhibit_a_snapshot_json && typeof input.data.exhibit_a_snapshot_json === "object"
          ? (input.data.exhibit_a_snapshot_json as object)
          : undefined,
      exhibit_b_snapshot_json:
        input.data.exhibit_b_snapshot_json && typeof input.data.exhibit_b_snapshot_json === "object"
          ? (input.data.exhibit_b_snapshot_json as object)
          : undefined,
    },
  });

  return NextResponse.json({ ok: true, msa }, { status: 201 });
}

