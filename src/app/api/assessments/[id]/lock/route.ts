// src/app/api/assessments/[id]/lock/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
    );
  }

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

const ParamsSchema = z.object({ id: z.string().uuid() });
const BodySchema = z.object({ locked: z.boolean() });

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // --- AUTH: Require logged-in Supabase user (cookie session) ---
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // --- ADMIN CHECK (email allowlist) ---
    if (!isAdminEmail(user.email ?? null)) {
      return NextResponse.json(
        { ok: false, error: "Forbidden: Admins only." },
        { status: 403 }
      );
    }

    const params = await context.params;
    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid assessment id (UUID)" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsedBody = BodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid body; expected { locked: boolean }" },
        { status: 400 }
      );
    }

    const { id } = parsedParams.data;
    const { locked } = parsedBody.data;

    const existing = await prisma.assessment.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Assessment not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.assessment.update({
        where: { id },
        data: { locked_at: locked ? new Date() : null },
        select: {
          id: true,
          locked_at: true,
          status: true,
        },
      });

    return NextResponse.json(
      { ok: true, assessment: updated },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/assessments/[id]/lock error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error.",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}