import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { z } from "zod";
import { Department, Industry } from "@prisma/client";

const BodySchema = z.object({
  locked_department: z.nativeEnum(Department).nullable(),
  industry: z.nativeEnum(Industry).nullable().optional(),
});

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * GET assessment metadata + organization name.
 * Auth: admin session OR invite link (?email=&token=) for a participant on this assessment.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: assessmentId } = await context.params;

  let authorized = false;
  const url = req.nextUrl;
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const token = (url.searchParams.get("token") ?? "").trim();

  if (email && token) {
    const tokenHash = sha256Hex(token);
    const participant = await prisma.participant.findFirst({
      where: {
        assessment_id: assessmentId,
        email,
        invite_token_hash: tokenHash,
        OR: [{ invite_token_expires_at: null }, { invite_token_expires_at: { gt: new Date() } }],
      },
      select: { id: true },
    });
    authorized = Boolean(participant);
  }

  if (!authorized) {
    const admin = await requireAdmin();
    authorized = Boolean(admin.user);
  }

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        name: true,
        assessment_type: true,
        question_set_version: true,
        locked_department: true,
        industry: true,
        organization_id: true,
        created_at: true,
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!assessment) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, assessment }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "Fetch failed", message },
      { status: 500 }
    );
  }
}

/**
 * ✅ PATCH — update locked department
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "Invalid body", message },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.assessment.update({
      where: { id },
      data: {
        locked_department: body.locked_department,
        ...(body.industry !== undefined ? { industry: body.industry } : {}),
      },
      select: { id: true, locked_department: true, industry: true },
    });

    return NextResponse.json({ ok: true, assessment: updated }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "Update failed", message },
      { status: 500 }
    );
  }
}