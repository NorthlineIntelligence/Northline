import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { z } from "zod";

const BodySchema = z.object({
  locked_department: z
    .enum(["SALES", "MARKETING", "CUSTOMER_SUCCESS", "OPS", "REVOPS", "GTM"])
    .nullable(),
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
    const updated = await prisma.assessment.update({
      where: { id },
      data: { locked_department: body.locked_department },
      select: { id: true, locked_department: true },
    });

    return NextResponse.json({ ok: true, assessment: updated }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Update failed", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
