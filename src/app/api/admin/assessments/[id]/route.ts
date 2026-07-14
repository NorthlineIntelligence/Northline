import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { z } from "zod";
import { Department, Industry, AssessmentAiProcessingMode } from "@prisma/client";

const BodySchema = z.object({
  locked_department: z.nativeEnum(Department).nullable().optional(),
  industry: z.nativeEnum(Industry).nullable().optional(),
  ai_processing_mode: z.enum(["fast", "executive"]).optional(),
});

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
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Invalid body", message: err?.message ?? String(err) },
      { status: 400 }
    );
  }

  try {
    const data: {
      locked_department?: Department | null;
      industry?: Industry | null;
      ai_processing_mode?: AssessmentAiProcessingMode;
    } = {};

    if (body.locked_department !== undefined) {
      data.locked_department = body.locked_department;
    }
    if (body.industry !== undefined) {
      data.industry = body.industry;
    }
    if (body.ai_processing_mode !== undefined) {
      data.ai_processing_mode =
        body.ai_processing_mode === "fast"
          ? AssessmentAiProcessingMode.FAST
          : AssessmentAiProcessingMode.EXECUTIVE;
    }

    const updated = await prisma.assessment.update({
      where: { id },
      data,
      select: {
        id: true,
        locked_department: true,
        industry: true,
        ai_processing_mode: true,
      },
    });

    return NextResponse.json({ ok: true, assessment: updated }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Update failed", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
