// src/app/api/assessments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type AssessmentType = "FULL" | "LITE";

type CreateAssessmentBody = {
  organizationId: string;
  version?: string | number;
  type: AssessmentType; // required
};

function resolveAssessmentName(type: AssessmentType): string {
  if (type === "FULL") return "NL-Assess";
  if (type === "LITE") return "NL-Lite";
  return "NL-Assess";
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.message },
      { status: admin.status }
    );
  }

  let body: CreateAssessmentBody;
  try {
    body = (await req.json()) as CreateAssessmentBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const organizationId = (body.organizationId ?? "").trim();
  const type = body.type;

  if (!organizationId) {
    return NextResponse.json(
      { ok: false, error: "organizationId is required" },
      { status: 400 }
    );
  }

  if (!type || (type !== "FULL" && type !== "LITE")) {
    return NextResponse.json(
      { ok: false, error: "type must be FULL or LITE" },
      { status: 400 }
    );
  }

  const version = body.version !== undefined ? String(body.version) : "1";
  const name = resolveAssessmentName(type);

  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!org) {
      return NextResponse.json(
        { ok: false, error: "Organization not found" },
        { status: 404 }
      );
    }

    const assessment = await prisma.assessment.create({
      data: {
        organization_id: organizationId,
        version,
        name,
        type, // only if your schema has this column (see note below)
      } as any,
      select: {
        id: true,
        organization_id: true,
        version: true,
        name: true,
        created_at: true,
      } as any,
    });

    return NextResponse.json({ ok: true, assessment }, { status: 201 });
  } catch (err: any) {
    console.error("[ASSESSMENTS_POST] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Create assessment failed",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}