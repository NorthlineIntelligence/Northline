// src/app/api/questions/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { Prisma } from "@prisma/client";
import { normalizeIndustryText } from "@/lib/assessmentIndustry";
import { renderQuestionText } from "@/lib/questionContextRenderer";

/**
 * Ingest/update questions (admin only).
 *
 * Notes:
 * - uses Prisma Question model: pillar, question_text, display_order, weight, active, version, audience
 * - upserts by unique constraint: [pillar, display_order, version, audience]
 * - validates duplicate keys inside the same payload before writing
 * - makes audience explicit so department-specific variants do not accidentally become ALL
 */

const PILLAR_VALUES = [
  "SYSTEM_INTEGRITY",
  "HUMAN_ALIGNMENT",
  "STRATEGIC_COHERENCE",
  "SUSTAINABILITY_PRACTICE",
] as const;
type Pillar = (typeof PILLAR_VALUES)[number];

const DEPARTMENT_VALUES = [
  "ALL",
  "SALES",
  "MARKETING",
  "CUSTOMER_SUCCESS",
  "LOGISTICS_SUPPLY_CHAIN",
  "IT",
  "OPS",
  "REVOPS",
  "ENGINEERING",
  "PRODUCT",
  "GTM",
] as const;
type Department = (typeof DEPARTMENT_VALUES)[number];

const CONTEXT_MODE_VALUES = ["APPEND", "INLINE", "NONE"] as const;
type QuestionContextMode = (typeof CONTEXT_MODE_VALUES)[number];

type Industry = ReturnType<typeof normalizeIndustryText> extends infer T
  ? Exclude<T, null>
  : never;

const OptionalQuestionTextSchema = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t.length === 0 ? undefined : t;
  },
  z.string().min(1).max(8000).optional()
);

const FlatQuestionSchema = z.object({
  pillar: z.enum(PILLAR_VALUES),
  question_text: OptionalQuestionTextSchema,
  question_core: OptionalQuestionTextSchema,
  context_mode: z.union([z.enum(CONTEXT_MODE_VALUES), z.string()]).optional().default("NONE"),
  industry_context_json: z.union([z.record(z.string(), z.string()), z.string()]).optional(),
  display_order: z.number().int().min(1).max(100000),
  weight: z.number().int().min(1).max(1000).optional().default(1),
  version: z.union([z.number().int().min(1).max(9999), z.string().min(1).max(50)]).optional(),
  active: z.boolean().optional().default(true),
  audience: z.union([z.enum(DEPARTMENT_VALUES), z.string()]).optional().default("ALL"),
  industry: z.string().optional().default("ALL_INDUSTRIES"),
});

const LegacyPillarSchema = z.object({
  pillar: z.union([z.enum(PILLAR_VALUES), z.string()]),
  questions: z
    .array(
      z.object({
        question_text: OptionalQuestionTextSchema,
        question_core: OptionalQuestionTextSchema,
        context_mode: z.union([z.enum(CONTEXT_MODE_VALUES), z.string()]).optional(),
        industry_context_json: z.union([z.record(z.string(), z.string()), z.string()]).optional(),
        display_order: z.number().int().min(1).max(100000).optional(),
        weight: z.number().int().min(1).max(1000).optional(),
        active: z.boolean().optional(),
        audience: z.union([z.enum(DEPARTMENT_VALUES), z.string()]).optional(),
        industry: z.string().optional(),
      })
    )
    .min(1)
    .max(500),
});

const LegacyPillarMapSchema = z.record(
  z.string(),
  z.array(
    z.object({
      question_text: OptionalQuestionTextSchema,
      question_core: OptionalQuestionTextSchema,
      context_mode: z.union([z.enum(CONTEXT_MODE_VALUES), z.string()]).optional(),
      industry_context_json: z.union([z.record(z.string(), z.string()), z.string()]).optional(),
      display_order: z.number().int().min(1).max(100000).optional(),
      weight: z.number().int().min(1).max(1000).optional(),
      active: z.boolean().optional(),
      audience: z.union([z.enum(DEPARTMENT_VALUES), z.string()]).optional(),
      industry: z.string().optional(),
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

function normalizeContextMode(raw: unknown): QuestionContextMode {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  if (s === "APPEND") return "APPEND";
  if (s === "INLINE") return "INLINE";
  return "NONE";
}

function parseIndustryContextJson(raw: unknown): Record<string, string> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .map(([k, v]) => [k, String(v ?? "").trim()] as const)
        .filter(([k, v]) => k.trim().length > 0 && v.length > 0)
    );
  }
  const s = String(raw ?? "").trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => [k, String(v ?? "").trim()] as const)
        .filter(([k, v]) => k.trim().length > 0 && v.length > 0)
    );
  } catch {
    return {};
  }
}

function normalizeAudienceText(raw: unknown): Department | null {
  const s = String(raw ?? "").trim();
  if (!s) return "ALL";
  const upper = s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases: Record<string, Department> = {
    LOGISTICS_SUPPLY_CHAIN: "LOGISTICS_SUPPLY_CHAIN",
    LOGISTICS: "LOGISTICS_SUPPLY_CHAIN",
    SUPPLY_CHAIN: "LOGISTICS_SUPPLY_CHAIN",
    LOGISTICS_AND_SUPPLY_CHAIN: "LOGISTICS_SUPPLY_CHAIN",
    IT: "IT",
    INFORMATION_TECHNOLOGY: "IT",
  };
  const mapped = aliases[upper] ?? (upper as Department);
  if (DEPARTMENT_VALUES.includes(mapped)) return mapped;
  return null;
}

function validateDuplicateKeys(
  questions: Array<{
    pillar: Pillar;
    display_order: number;
    audience: Department;
    industry: Industry;
    question_core: string;
    question_text: string;
  }>
) {
  const seen = new Map<string, string>();

  for (const q of questions) {
    const key = `${q.pillar}::${q.audience}::${q.industry}::${q.display_order}`;
    const prior = seen.get(key);

    if (prior) {
      throw new Error(
        `Duplicate question key in ingest payload for pillar=${q.pillar}, audience=${q.audience}, industry=${q.industry}, display_order=${q.display_order}. Existing="${prior}" New="${q.question_text}"`
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

    const rawQuestions = Array.isArray(parsed.data.questions)
      ? parsed.data.questions.map((q) => ({
          pillar: q.pillar,
          question_core: normalizeQuestionText(q.question_core ?? q.question_text ?? ""),
          question_text: normalizeQuestionText(q.question_text ?? q.question_core ?? ""),
          context_mode: normalizeContextMode(q.context_mode),
          industry_context_json: parseIndustryContextJson(q.industry_context_json),
          display_order: q.display_order,
          weight: q.weight ?? 1,
          active: q.active ?? true,
          audienceRaw: q.audience,
          industryRaw: q.industry,
          version: normalizeVersion(q.version ?? defaultVersion),
        }))
      : legacyPillars.flatMap((pillarGroup) => {
          const pillarValue = String(pillarGroup.pillar).trim().toUpperCase() as Pillar;

          return pillarGroup.questions.map((q, idx) => ({
            pillar: pillarValue,
            question_core: normalizeQuestionText(q.question_core ?? q.question_text ?? ""),
            question_text: normalizeQuestionText(q.question_text ?? q.question_core ?? ""),
            context_mode: normalizeContextMode(q.context_mode),
            industry_context_json: parseIndustryContextJson(q.industry_context_json),
            display_order: q.display_order ?? idx + 1,
            weight: q.weight ?? 1,
            active: q.active ?? true,
            audienceRaw: q.audience,
            industryRaw: q.industry,
            version: defaultVersion,
          }));
        });

    const normalizedQuestions = rawQuestions.map((q, idx) => {
      const audience = normalizeAudienceText(q.audienceRaw);
      if (!audience) {
        throw new Error(
          `Invalid audience at row ${idx + 1} (${q.pillar} #${q.display_order}): "${String(
            q.audienceRaw ?? ""
          )}".`
        );
      }

      const industry = (normalizeIndustryText(String(q.industryRaw ?? "")) ?? "ALL_INDUSTRIES") as Industry;
      const questionCore = q.question_core || q.question_text;
      if (!questionCore) {
        throw new Error(
          `Missing question_core/question_text at row ${idx + 1} (${q.pillar} #${q.display_order}).`
        );
      }
      const questionText =
        q.question_text ||
        renderQuestionText({
          questionCore,
          contextMode: q.context_mode,
          selectedIndustry: industry,
          industryContextJson: q.industry_context_json,
        });

      return {
        pillar: q.pillar,
        question_core: questionCore,
        question_text: questionText,
        context_mode: q.context_mode,
        industry_context_json: q.industry_context_json,
        display_order: q.display_order,
        weight: q.weight,
        active: q.active,
        audience,
        industry,
        version: q.version,
      };
    });

    validateDuplicateKeys(normalizedQuestions);

    // Avoid long interactive transactions that can expire during large imports.
    let upsertedCount = 0;
    for (const q of normalizedQuestions) {
      await prisma.question.upsert({
        where: {
          pillar_display_order_version_audience_industry: {
            industry: q.industry,
            pillar: q.pillar,
            display_order: q.display_order,
            version: q.version,
            audience: q.audience,
          },
        },
        create: {
          pillar: q.pillar,
          question_core: q.question_core,
          question_text: q.question_text,
          context_mode: q.context_mode,
          industry_context_json: Object.keys(q.industry_context_json).length
            ? (q.industry_context_json as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          display_order: q.display_order,
          weight: q.weight,
          active: q.active,
          version: q.version,
          audience: q.audience,
          industry: q.industry,
        },
        update: {
          question_core: q.question_core,
          question_text: q.question_text,
          context_mode: q.context_mode,
          industry_context_json: Object.keys(q.industry_context_json).length
            ? (q.industry_context_json as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          weight: q.weight,
          active: q.active,
        },
      });
      upsertedCount += 1;
    }

    let deactivatedCount = 0;
    if (deactivateMissing) {
      const touchedVersions = Array.from(new Set(normalizedQuestions.map((q) => q.version)));
      const touchedPillars = Array.from(new Set(normalizedQuestions.map((q) => q.pillar)));
      const touchedAudiences = Array.from(new Set(normalizedQuestions.map((q) => q.audience)));
      const touchedIndustries = Array.from(new Set(normalizedQuestions.map((q) => q.industry)));

      const keepKeys = new Set(
        normalizedQuestions.map(
          (q) =>
            `${q.version}::${q.pillar}::${q.audience}::${q.industry}::${q.display_order}`
        )
      );

      const existing = await prisma.question.findMany({
        where: {
          version: { in: touchedVersions },
          pillar: { in: touchedPillars },
          audience: { in: touchedAudiences },
          industry: { in: touchedIndustries },
        },
        select: {
          id: true,
          version: true,
          pillar: true,
          audience: true,
          industry: true,
          display_order: true,
        },
      });

      const idsToDeactivate = existing
        .filter(
          (e) =>
            !keepKeys.has(
              `${e.version}::${e.pillar}::${e.audience}::${e.industry}::${e.display_order}`
            )
        )
        .map((e) => e.id);

      if (idsToDeactivate.length > 0) {
        const r = await prisma.question.updateMany({
          where: { id: { in: idsToDeactivate } },
          data: { active: false },
        });
        deactivatedCount = r.count;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        version: defaultVersion,
        normalizedQuestionCount: normalizedQuestions.length,
        upsertedCount,
        deactivatedCount,
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