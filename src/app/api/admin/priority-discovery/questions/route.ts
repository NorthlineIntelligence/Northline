/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import {
  PRIORITY_DISCOVERY_SEED_QUESTIONS,
  type PriorityQuestionInput,
  PriorityQuestionInputSchema,
  parsePriorityCsvImport,
  parsePriorityJsonImport,
} from "@/lib/priorityDiscovery/questions";

function jsonOrNull(value: unknown) {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function toClientQuestion(q: any) {
  return {
    id: q.id,
    assessmentType: "priority_discovery",
    questionSetVersion: q.question_set_version,
    section: q.section,
    questionText: q.question_text,
    questionHelpText: q.question_help_text,
    responseType: q.response_type,
    options: Array.isArray(q.options) ? q.options : [],
    scaleMin: q.scale_min,
    scaleMax: q.scale_max,
    scaleLabels: q.scale_labels && typeof q.scale_labels === "object" ? q.scale_labels : null,
    required: q.required,
    order: q.order,
    tags: Array.isArray(q.tags) ? q.tags : [],
    scoringDimension: q.scoring_dimension,
    isActive: q.is_active,
    createdAt: q.created_at,
    updatedAt: q.updated_at,
  };
}

function toPrismaData(input: PriorityQuestionInput) {
  return {
    assessment_type: "PRIORITY_DISCOVERY" as const,
    question_set_version: input.questionSetVersion,
    section: input.section,
    question_text: input.questionText,
    question_help_text: input.questionHelpText || null,
    response_type: input.responseType,
    options: jsonOrNull(input.options ?? []),
    scale_min: input.scaleMin ?? null,
    scale_max: input.scaleMax ?? null,
    scale_labels: jsonOrNull(input.scaleLabels ?? null),
    required: input.required,
    order: input.order,
    tags: jsonOrNull(input.tags ?? []),
    scoring_dimension: input.scoringDimension ?? null,
    is_active: input.isActive,
  };
}

const PostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    question: PriorityQuestionInputSchema,
  }),
  z.object({
    action: z.literal("seed"),
    version: z.string().min(1).max(50).default("1"),
  }),
  z.object({
    action: z.literal("import"),
    version: z.string().min(1).max(50).default("1"),
    format: z.enum(["json", "csv"]),
    raw: z.string().min(1),
  }),
  z.object({
    action: z.literal("duplicate"),
    sourceVersion: z.string().min(1).max(50),
    targetVersion: z.string().min(1).max(50),
  }),
]);

const PatchSchema = z.object({
  id: z.string().uuid(),
  question: PriorityQuestionInputSchema.partial().extend({
    section: z.string().min(1).max(200).optional(),
    questionText: z.string().min(1).max(8000).optional(),
    responseType: z.any().optional(),
    required: z.boolean().optional(),
    order: z.number().int().min(1).max(100000).optional(),
    isActive: z.boolean().optional(),
  }),
});

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const version = req.nextUrl.searchParams.get("version") ?? undefined;
  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "true";

  const questions = await prisma.priorityQuestion.findMany({
    where: {
      assessment_type: "PRIORITY_DISCOVERY",
      ...(version ? { question_set_version: version } : {}),
      ...(includeInactive ? {} : { is_active: true }),
    },
    orderBy: [{ question_set_version: "desc" }, { order: "asc" }, { created_at: "asc" }],
  });

  return NextResponse.json({
    ok: true,
    questions: questions.map(toClientQuestion),
    versions: Array.from(new Set(questions.map((q) => q.question_set_version))).sort().reverse(),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const action = parsed.data.action;

  if (action === "create") {
    const question = await prisma.priorityQuestion.create({
      data: toPrismaData(parsed.data.question),
    });
    return NextResponse.json({ ok: true, question: toClientQuestion(question) }, { status: 201 });
  }

  if (action === "seed") {
    const version = parsed.data.version;
    const created = await Promise.all(
      PRIORITY_DISCOVERY_SEED_QUESTIONS.map((question) =>
        prisma.priorityQuestion.create({
          data: toPrismaData({ ...question, questionSetVersion: version }),
        })
      )
    );
    return NextResponse.json({ ok: true, count: created.length, questions: created.map(toClientQuestion) }, { status: 201 });
  }

  if (action === "import") {
    const importRequest = parsed.data;
    let questions;
    try {
      questions =
        importRequest.format === "json"
          ? parsePriorityJsonImport(importRequest.raw)
          : parsePriorityCsvImport(importRequest.raw);
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: err?.message ?? "Import parse failed" }, { status: 400 });
    }

    const created = await Promise.all(
      questions.map((question) =>
        prisma.priorityQuestion.create({
          data: toPrismaData({ ...question, questionSetVersion: importRequest.version }),
        })
      )
    );
    return NextResponse.json({ ok: true, count: created.length, questions: created.map(toClientQuestion) }, { status: 201 });
  }

  const duplicateRequest = parsed.data;
  const existing = await prisma.priorityQuestion.findMany({
    where: {
      assessment_type: "PRIORITY_DISCOVERY",
      question_set_version: duplicateRequest.sourceVersion,
    },
    orderBy: { order: "asc" },
  });
  if (existing.length === 0) {
    return NextResponse.json({ ok: false, error: "Source version has no questions." }, { status: 404 });
  }

  const created = await Promise.all(
    existing.map((question) =>
      prisma.priorityQuestion.create({
        data: {
          assessment_type: "PRIORITY_DISCOVERY",
          question_set_version: duplicateRequest.targetVersion,
          section: question.section,
          question_text: question.question_text,
          question_help_text: question.question_help_text,
          response_type: question.response_type,
          options: jsonOrNull(question.options),
          scale_min: question.scale_min,
          scale_max: question.scale_max,
          scale_labels: jsonOrNull(question.scale_labels),
          required: question.required,
          order: question.order,
          tags: jsonOrNull(question.tags),
          scoring_dimension: question.scoring_dimension,
          is_active: question.is_active,
        },
      })
    )
  );

  return NextResponse.json({ ok: true, count: created.length, questions: created.map(toClientQuestion) }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const q = parsed.data.question;
  const data: Record<string, any> = {};
  if (q.questionSetVersion !== undefined) data.question_set_version = q.questionSetVersion;
  if (q.section !== undefined) data.section = q.section;
  if (q.questionText !== undefined) data.question_text = q.questionText;
  if (q.questionHelpText !== undefined) data.question_help_text = q.questionHelpText || null;
  if (q.responseType !== undefined) data.response_type = q.responseType;
  if (q.options !== undefined) data.options = jsonOrNull(q.options);
  if (q.scaleMin !== undefined) data.scale_min = q.scaleMin;
  if (q.scaleMax !== undefined) data.scale_max = q.scaleMax;
  if (q.scaleLabels !== undefined) data.scale_labels = jsonOrNull(q.scaleLabels);
  if (q.required !== undefined) data.required = q.required;
  if (q.order !== undefined) data.order = q.order;
  if (q.tags !== undefined) data.tags = jsonOrNull(q.tags);
  if (q.scoringDimension !== undefined) data.scoring_dimension = q.scoringDimension;
  if (q.isActive !== undefined) data.is_active = q.isActive;

  const updated = await prisma.priorityQuestion.update({
    where: { id: parsed.data.id },
    data,
  });

  return NextResponse.json({ ok: true, question: toClientQuestion(updated) });
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  await prisma.priorityQuestion.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
