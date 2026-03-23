// src/app/api/questions/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { Pillar, Department } from "@prisma/client";

/**
 * Ingest/update questions (admin only).
 *
 * Notes:
 * - uses Prisma Question model: pillar, question_text, display_order, weight, active, version, audience
 * - upserts by unique constraint: [pillar, display_order, version, audience]
 * - validates duplicate keys inside the same payload before writing
 * - makes audience explicit so department-specific variants do not accidentally become ALL
 */

const FlatQuestionSchema = z.object({
  pillar: z.nativeEnum(Pillar),
  question_text: z.string().min(1).max(8000),
  display_order: z.number().int().min(1).max(100000),
  weight: z.number().int().min(1).max(1000).optional().default(1),
  version: z.union([z.number().int().min(1).max(9999), z.string().min(1).max(50)]).optional(),
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

const LegacyPillarMapSchema = z.record(
  z.string(),
  z.array(
    z.object({
      question_text: z.string().min(1).max(8000),
      display_order: z.number().int().min(1).max(100000).optional(),
      weight: z.number().int().min(1).max(1000).optional(),
      active: z.boolean().optional(),
      audience: z.nativeEnum(Department).optional(),
    })
  )
);

const BodySchema = z
  .object({
    version: z.union([z.number().int().min(1).max(9999), z.string().min(1).max(50)]).optional(),
    questions: z.array(FlatQuestionSchema).min(1).max(500).optional(),
    pillars: z
      .union([
        z.array(LegacyPillarSchema).min(1).max(100),
        LegacyPillarSchema,
        LegacyPillarMapSchema,
      ])
      .optional(),
    deactivateMissing: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasQuestions = Array.isArray(val.questions) && val.questions.length > 0;
    const hasPillars =
      val.pillars !== undefined &&
      val.pillars !== null &&
      ((Array.isArray(val.pillars) && val.pillars.length > 0) ||
        (!Array.isArray(val.pillars) && typeof val.pillars === "object"));

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

function normalizeVersion(value: string | number | undefined) {
  const raw = value ?? 1;
  return typeof raw === "number" ? String(raw) : String(raw).trim() || "1";
}

function normalizeQuestionText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function validateDuplicateKeys(
  questions: Array<{
    pillar: Pillar;
    display_order: number;
    audience: Department;
    question_text: string;
  }>
) {
  const seen = new Map<string, string>();

  for (const q of questions) {
    const key = `${q.pillar}::${q.audience}::${q.display_order}`;
    const prior = seen.get(key);

    if (prior) {
      throw new Error(
        `Duplicate question key in ingest payload for pillar=${q.pillar}, audience=${q.audience}, display_order=${q.display_order}. Existing="${prior}" New="${q.question_text}"`
      );
    }

    seen.set(key, q.question_text);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!admin.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid body",
          issues: parsed.error.issues,
          receivedType: typeof json,
          receivedKeys:
            json && typeof json === "object" && !Array.isArray(json)
              ? Object.keys(json)
              : [],
          receivedBody: json,
        },
        { status: 400 }
      );
    }

    const { deactivateMissing } = parsed.data;
    const defaultVersion = normalizeVersion(parsed.data.version);
    const rawPillars = parsed.data.pillars;

    const legacyPillars =
      !rawPillars
        ? []
        : Array.isArray(rawPillars)
        ? rawPillars
        : "pillar" in rawPillars && "questions" in rawPillars
        ? [rawPillars]
        : Object.entries(rawPillars).map(([pillar, questions]) => ({
            pillar,
            questions,
          }));

    const normalizedQuestions = Array.isArray(parsed.data.questions)
      ? parsed.data.questions.map((q) => ({
          pillar: q.pillar,
          question_text: normalizeQuestionText(q.question_text),
          display_order: q.display_order,
          weight: q.weight ?? 1,
          active: q.active ?? true,
          audience: q.audience ?? Department.ALL,
          version: normalizeVersion(q.version ?? defaultVersion),
        }))
      : legacyPillars.flatMap((pillarGroup) => {
          const pillarValue = String(pillarGroup.pillar).trim().toUpperCase() as Pillar;

          return pillarGroup.questions.map((q, idx) => ({
            pillar: pillarValue,
            question_text: normalizeQuestionText(q.question_text),
            display_order: q.display_order ?? idx + 1,
            weight: q.weight ?? 1,
            active: q.active ?? true,
            audience: q.audience ?? Department.ALL,
            version: defaultVersion,
          }));
        });

    validateDuplicateKeys(normalizedQuestions);

    const results = await prisma.$transaction(async (tx) => {
      const upserted = [];

      for (const q of normalizedQuestions) {
        const row = await tx.question.upsert({
          where: {
            pillar_display_order_version_audience: {
              pillar: q.pillar,
              display_order: q.display_order,
              version: q.version,
              audience: q.audience,
            },
          },
          create: {
            pillar: q.pillar,
            question_text: q.question_text,
            display_order: q.display_order,
            weight: q.weight,
            active: q.active,
            version: q.version,
            audience: q.audience,
          },
          update: {
            question_text: q.question_text,
            weight: q.weight,
            active: q.active,
          },
        });

        upserted.push(row);
      }

      let deactivatedCount = 0;

      if (deactivateMissing) {
        const touchedVersions = Array.from(new Set(normalizedQuestions.map((q) => q.version)));
        const touchedPillars = Array.from(new Set(normalizedQuestions.map((q) => q.pillar)));
        const touchedAudiences = Array.from(new Set(normalizedQuestions.map((q) => q.audience)));

        const keepKeys = new Set(
          normalizedQuestions.map(
            (q) => `${q.version}::${q.pillar}::${q.audience}::${q.display_order}`
          )
        );

        const existing = await tx.question.findMany({
          where: {
            version: { in: touchedVersions },
            pillar: { in: touchedPillars },
            audience: { in: touchedAudiences },
          },
          select: {
            id: true,
            version: true,
            pillar: true,
            audience: true,
            display_order: true,
          },
        });

        const idsToDeactivate = existing
          .filter(
            (e) =>
              !keepKeys.has(`${e.version}::${e.pillar}::${e.audience}::${e.display_order}`)
          )
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
      {
        ok: true,
        version: defaultVersion,
        normalizedQuestionCount: normalizedQuestions.length,
        ...results,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/questions/ingest error:", err);

    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}