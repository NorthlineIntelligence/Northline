import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const BodySchema = z.object({
  email: z.string().email(),
});

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase env vars. Need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)."
    );
  }

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}

export async function POST(req: Request) {
  try {
    // 🚨 DEV-ONLY WARNING
    // This endpoint is to get you logged-in during dev without building UI yet.
    // TODO (before production): remove this route or protect it behind an env flag.
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseServerClient();

    // This sends a magic link to the email.
    // After clicking it, Supabase redirects back to your app with a session.
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        // Must be an allowed redirect URL in Supabase Auth settings.
        emailRedirectTo: "http://localhost:3000/auth/callback",
      },
    });

    if (error) {
      return NextResponse.json(
        { error: "Failed to send magic link", message: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, message: "Magic link sent" });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Internal Server Error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}