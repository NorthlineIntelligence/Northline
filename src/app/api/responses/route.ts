// src/app/api/responses/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createHash } from "crypto";

const BodySchema = z
  .object({
    assessment_id: z.string().uuid(),
    participant_id: z.string().uuid(),
    // invite auth (participants with no Supabase session)
    email: z.string().email().optional(),
    token: z.string().min(16).optional(),
    responses: z
      .array(
        z.object({
          question_id: z.string().uuid(),
          score: z.number().int().min(1).max(5),
          free_write: z.string().optional(),
        })
      )
      .min(1),
  })
  .strict();

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // ignore
        }
      },
    },
  });
}

function sha256Hex(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Bad Request", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { assessment_id, participant_id, responses } = parsed.data;
    const email = (parsed.data.email ?? "").trim().toLowerCase();
    const token = (parsed.data.token ?? "").trim();

    // ---------- AUTH (either Supabase session OR invite email+token) ----------
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    let authorizedParticipantId: string | null = null;

    // A) Logged in: enforce membership by user_id + assessment
    if (!userError && user?.id) {
      const membership = await prisma.participant.findFirst({
        where: { assessment_id, user_id: user.id },
        select: { id: true },
      });

      if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      authorizedParticipantId = membership.id;
    } else {
      // B) Invite flow: must have email + token
      if (!email || !token) {
        return NextResponse.json(
          {
            error: "Unauthorized",
            message: "No session found. Provide email and token to submit responses.",
          },
          { status: 401 }
        );
      }

      const tokenHash = sha256Hex(token);

      const invited = await prisma.participant.findFirst({
        where: {
          assessment_id,
          email,
          invite_token_hash: tokenHash,
          OR: [
            { invite_token_expires_at: null },
            { invite_token_expires_at: { gt: new Date() } },
          ],
        },
        select: { id: true },
      });

      if (!invited) {
        return NextResponse.json(
          { error: "Unauthorized", message: "Invite link invalid or expired." },
          { status: 401 }
        );
      }

      authorizedParticipantId = invited.id;
    }

    // You can only submit for yourself
    if (authorizedParticipantId !== participant_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // ---------- END AUTH ----------

    // ---------- Duplicate protection in payload ----------
    const seen = new Set<string>();
    const duplicateQuestionIds: string[] = [];
    for (const r of responses) {
      if (seen.has(r.question_id)) duplicateQuestionIds.push(r.question_id);
      seen.add(r.question_id);
    }
    if (duplicateQuestionIds.length) {
      return NextResponse.json(
        { error: "Duplicate question ids in payload", duplicateQuestionIds },
        { status: 400 }
      );
    }

    // ---------- Write responses + mark participant completed ----------
    try {
      await prisma.$transaction(async (tx) => {
        await tx.response.createMany({
          data: responses.map((r) => ({
            assessment_id,
            participant_id,
            question_id: r.question_id,
            score: r.score,
            free_write: r.free_write ?? null,
          })),
          skipDuplicates: true,
        });

        // ✅ Mark completion (idempotent).
        // If they resubmit (duplicates skipped), we still want completed_at to be set.
        await tx.participant.updateMany({
          where: {
            id: participant_id,
            assessment_id,
            completed_at: null,
          },
          data: {
            completed_at: new Date(),
          },
        });
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        return NextResponse.json(
          { error: "Duplicate response detected (already submitted for one or more questions)." },
          { status: 409 }
        );
      }
      throw e;
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Internal Server Error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}