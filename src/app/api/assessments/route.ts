import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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

/**
 * GET /api/assessments
 * Returns assessments visible to the current user via Participant membership.
 * (Facilitated diagnostic: this is enough for v1.1 UI navigation.)
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    const contentType = req.headers.get("content-type") ?? "";
    const accept = req.headers.get("accept") ?? "";

    if (userError || !user) {
      if (accept.includes("text/html")) {
        return NextResponse.redirect(new URL("/admin/login", req.url), {
          status: 303,
        });
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = (user.email ?? "").trim().toLowerCase();
    if (!isAdminEmail(email)) {
      if (accept.includes("text/html")) {
        return NextResponse.redirect(
          new URL("/admin/login?error=forbidden", req.url),
          { status: 303 }
        );
      }
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    let organizationId: unknown = undefined;

    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({} as any));
      organizationId = body?.organizationId;
    } else {
      // Supports form POSTs from plain HTML <form>
      const form = await req.formData().catch(() => null);
      organizationId = form?.get("organizationId");
    }

    if (!organizationId || typeof organizationId !== "string") {
      return NextResponse.json(
        { error: "Bad Request", message: "organizationId is required" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const assessment = await tx.assessment.create({
        data: {
          organization_id: organizationId,
        },
        select: { id: true, organization_id: true },
      });

      
      return assessment;
    });

    // If this was a browser form post, redirect straight into the assessment flow
    if (accept.includes("text/html")) {
      return NextResponse.redirect(
        new URL(`/assessments/${result.id}`, req.url),
        { status: 303 }
      );
    }

    return NextResponse.json({ assessment: result }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Internal Server Error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}