// src/app/api/questions/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { Pillar } from "@prisma/client";

type IngestQuestionInput = {
  question_text?: string;
  prompt?: string;
  text?: string;

  display_order?: number;
  weight?: number;
  active?: boolean;

  // optional: in case payload includes it even though nested by pillar
  pillar?: string;
};

type IngestBody = {
  version?: number | string;
  pillars?: Record<string, IngestQuestionInput[]>;
};

function normalizePillar(input: string): Pillar | null {
  const raw = (input ?? "").toString().trim();

  // exact match against enum
  if ((Object.values(Pillar) as string[]).includes(raw)) return raw as Pillar;

  // normalize common formats: "Strategic Coherence" -> "STRATEGIC_COHERENCE"
  const normalized = raw.toUpperCase().replace(/\s+/g, "_");
  if ((Object.values(Pillar) as string[]).includes(normalized)) return normalized as Pillar;

  return null;
}

function normalizeQuestionText(q: IngestQuestionInput): string {
  return (q.question_text ?? q.prompt ?? q.text ?? "").toString().trim();
}

export async function POST(req: NextRequest) {
  // 1) Admin guard (your existing pattern returns {ok,status,message})
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.message },
      { status: admin.status }
    );
  }

  // 2) Parse body
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const version = body.version !== undefined ? String(body.version) : "1";

  if (!body.pillars || typeof body.pillars !== "object") {
    return NextResponse.json(
      { ok: false, error: "Missing pillars object" },
      { status: 400 }
    );
  }

  const pillarKeys = Object.keys(body.pillars);
  if (pillarKeys.length === 0) {
    return NextResponse.json(
      { ok: false, error: "pillars object is empty" },
      { status: 400 }
    );
  }

  const allowedPillars = Object.values(Pillar);

  // 3) Normalize + validate into Prisma rows
  const invalidPillars: Array<{ key: string; normalizedTried: string }> = [];
  const skippedQuestions: Array<{ pillar: string; reason: string }> = [];

  const rowsToInsert = pillarKeys.flatMap((pillarKey) => {
    const arr = body.pillars?.[pillarKey];
    if (!Array.isArray(arr)) return [];

    const pillarValue = normalizePillar(pillarKey);
    if (!pillarValue) {
      invalidPillars.push({
        key: pillarKey,
        normalizedTried: pillarKey.toUpperCase().replace(/\s+/g, "_"),
      });
      return [];
    }

    return arr
      .map((q, idx) => {
        // If question includes its own pillar, validate it too (and prefer it)
        const pillarFromQuestionRaw = q.pillar ? String(q.pillar) : "";
        const pillarFromQuestion = pillarFromQuestionRaw
          ? normalizePillar(pillarFromQuestionRaw)
          : null;

        const finalPillar = pillarFromQuestion ?? pillarValue;
        if (!finalPillar) {
          skippedQuestions.push({
            pillar: pillarKey,
            reason: `Invalid pillar on question item: "${pillarFromQuestionRaw}"`,
          });
          return null;
        }

        const question_text = normalizeQuestionText(q);
        if (!question_text) {
          skippedQuestions.push({ pillar: pillarKey, reason: "Missing question_text/prompt/text" });
          return null;
        }

        const display_order =
          typeof q.display_order === "number" && Number.isFinite(q.display_order)
            ? q.display_order
            : idx + 1;

        const weight =
          typeof q.weight === "number" && Number.isFinite(q.weight) ? q.weight : 1;

        const active = typeof q.active === "boolean" ? q.active : true;

        return {
          pillar: finalPillar,
          question_text, // If Prisma field is questionText, see NOTE below
          display_order,
          weight,
          active,
          version,
        };
      })
      .filter(Boolean) as Array<{
      pillar: Pillar;
      question_text: string;
      display_order: number;
      weight: number;
      active: boolean;
      version: number;
    }>;
  });

  // 4) Fail fast with helpful info if nothing to insert
  if (rowsToInsert.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "No rows to insert",
        version,
        receivedPillarKeys: pillarKeys,
        invalidPillars,
        skippedQuestions,
        allowedPillars,
        expectedPayloadExample: {
          version: 1,
          pillars: {
            STRATEGIC_COHERENCE: [
              { display_order: 1, question_text: "…", weight: 1, active: true },
            ],
          },
        },
      },
      { status: 400 }
    );
  }

  // 5) Insert into DB
  try {
    // NOTE:
    // If this line throws "Unknown argument question_text" then your Prisma field is `questionText`.
    // In that case, change the data mapping to `questionText: question_text` before insert.
    const result = await prisma.question.createMany({
      data: rowsToInsert as any,
      skipDuplicates: true,
    });

    return NextResponse.json({
      ok: true,
      version,
      created: result.count,
      receivedPillarKeys: pillarKeys,
      invalidPillars,
      skippedQuestions,
    });
  } catch (err: any) {
    console.error("[QUESTIONS_INGEST] Prisma error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Ingest failed",
        message: err?.message ?? String(err),
        code: err?.code,
      },
      { status: 500 }
    );
  }
}