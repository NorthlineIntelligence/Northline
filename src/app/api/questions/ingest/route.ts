// src/app/api/questions/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { requireAdmin } from "@/lib/authz";
import { Pillar, Department } from "@prisma/client";

/**
 * Ingest/update questions (admin only).
 *
 * Notes:
 * - uses your Prisma Question model: pillar, question_text, display_order, weight, active, version, audience
 * - upserts by the unique constraint: [pillar, display_order, version, audience]
 */

const BodySchema = z
  .object({
    version: z.number().int().min(1).max(9999).default(1),
    questions: z
      .array(
        z.object({
          pillar: z.nativeEnum(Pillar),
          question_text: z.string().min(1).max(8000),
          display_order: z.number().int().min(1).max(100000),
          weight: z.number().int().min(1).max(1000).optional().default(1),
          active: z.boolean().optional().default(true),
          audience: z.nativeEnum(Department).optional().default(Department.ALL),
        })
      )
      .min(1)
      .max(500),
    // If true, we deactivate questions in THIS version not present in payload
    // (scoped to the pillars/audiences touched by this payload).
    deactivateMissing: z.boolean().optional().default(false),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    // ✅ Admin gate (your requireAdmin takes ZERO args and returns { user, email })
    const admin = await requireAdmin();
    if (!admin.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid body", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { version, questions, deactivateMissing } = parsed.data;
const versionStr = String(version);
    // Upsert each question by your unique constraint:
    // @@unique([pillar, display_order, version, audience])
    const results = await prisma.$transaction(async (tx) => {
      const upserted = [];
      for (const q of questions) {
        const row = await tx.question.upsert({
          where: {
            pillar_display_order_version_audience: {
              pillar: q.pillar,
              display_order: q.display_order,
              version: versionStr,
              audience: q.audience,
            },
          },
          create: {
            pillar: q.pillar,
            question_text: q.question_text,
            display_order: q.display_order,
            weight: q.weight ?? 1,
            active: q.active ?? true,
            version: versionStr,
            audience: q.audience,
          },
          update: {
            question_text: q.question_text,
            weight: q.weight ?? 1,
            active: q.active ?? true,
          },
        });
        upserted.push(row);
      }

      // Optional: deactivate missing questions (same version, only for pillars/audiences included)
      let deactivatedCount = 0;
      if (deactivateMissing) {
        const touchedPillars = Array.from(new Set(questions.map((q) => q.pillar)));
        const touchedAudiences = Array.from(new Set(questions.map((q) => q.audience)));

        const keepKeys = new Set(
          questions.map((q) => `${q.pillar}::${q.audience}::${q.display_order}`)
        );

        const existing = await tx.question.findMany({
          where: {
            version: versionStr,
            pillar: { in: touchedPillars },
            audience: { in: touchedAudiences },
          },
          select: { id: true, pillar: true, audience: true, display_order: true },
        });

        const idsToDeactivate = existing
          .filter((e) => !keepKeys.has(`${e.pillar}::${e.audience}::${e.display_order}`))
          .map((e) => e.id);

        if (idsToDeactivate.length > 0) {
          const r = await tx.question.updateMany({
            where: { id: { in: idsToDeactivate } },
            data: { active: false },
          });
          deactivatedCount = r.count;
        }
      }

      return { upsertedCount: upserted.length, deactivatedCount };
    });

    return NextResponse.json(
      { ok: true, version: versionStr, ...results },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/questions/ingest error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}