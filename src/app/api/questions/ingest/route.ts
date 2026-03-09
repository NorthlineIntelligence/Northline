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

const FlatQuestionSchema = z.object({
  pillar: z.nativeEnum(Pillar),
  question_text: z.string().min(1).max(8000),
  display_order: z.number().int().min(1).max(100000),
  weight: z.number().int().min(1).max(1000).optional().default(1),
  active: z.boolean().optional().default(true),
  audience: z.nativeEnum(Department).optional().default(Department.ALL),
});

const LegacyPillarSchema = z.object({
  pillar: z.union([z.nativeEnum(Pillar), z.string()]),
  questions: z
    .array(
      z.object({
        question_text: z.string().min(1).max(8000),
        display_order: z.number().int().min(1).max(100000).optional(),
        weight: z.number().int().min(1).max(1000).optional(),
        active: z.boolean().optional(),
        audience: z.nativeEnum(Department).optional(),
      })
    )
    .min(1)
    .max(500),
});

const BodySchema = z
  .object({
    version: z.union([z.number().int().min(1).max(9999), z.string().min(1).max(50)]).optional(),
    questions: z.array(FlatQuestionSchema).min(1).max(500).optional(),
    pillars: z.array(LegacyPillarSchema).min(1).max(100).optional(),
    deactivateMissing: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasQuestions = Array.isArray(val.questions);
    const hasPillars = Array.isArray(val.pillars);

    if (!hasQuestions && !hasPillars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions"],
        message: 'Provide either "questions" or "pillars".',
      });
    }

    if (hasQuestions && hasPillars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'Provide only one of "questions" or "pillars", not both.',
      });
    }
  });

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

    const { deactivateMissing } = parsed.data;

const rawVersion = parsed.data.version ?? 1;

const versionStr =
  typeof rawVersion === "number"
    ? String(rawVersion)
    : String(rawVersion).trim() || "1";

const normalizedQuestions = Array.isArray(parsed.data.questions)
  ? parsed.data.questions
  : (parsed.data.pillars ?? []).flatMap((pillarGroup) => {
      const pillarValue = String(pillarGroup.pillar).trim().toUpperCase() as Pillar;

      return pillarGroup.questions.map((q, idx) => ({
        pillar: pillarValue,
        question_text: q.question_text,
        display_order: q.display_order ?? idx + 1,
        weight: q.weight ?? 1,
        active: q.active ?? true,
        audience: q.audience ?? Department.ALL,
      }));
    });
    // Upsert each question by your unique constraint:
    // @@unique([pillar, display_order, version, audience])
    const results = await prisma.$transaction(async (tx) => {
      const upserted = [];
      for (const q of normalizedQuestions) {
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
        const touchedPillars = Array.from(new Set(normalizedQuestions.map((q) => q.pillar)));
const touchedAudiences = Array.from(new Set(normalizedQuestions.map((q) => q.audience)));

const keepKeys = new Set(
  normalizedQuestions.map((q) => `${q.pillar}::${q.audience}::${q.display_order}`)
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
      { ok: true, version: versionStr, normalizedQuestionCount: normalizedQuestions.length, ...results },
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