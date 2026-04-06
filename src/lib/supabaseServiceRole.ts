import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Strip BOM, wrapping quotes, and accidental "Bearer " prefixes from env secrets.
 */
export function normalizeSupabaseSecret(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.trim().replace(/^\uFEFF/, "");
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (s.toLowerCase().startsWith("bearer ")) {
    s = s.slice(7).trim();
  }
  return s;
}

/**
 * Hosted Supabase API keys are JWTs with three dot-separated segments (typically start with "eyJ").
 */
export function isLikelySupabaseJwtApiKey(key: string): boolean {
  if (!key || key.length < 80) return false;
  const parts = key.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/**
 * User-facing hint when Storage/Auth returns JWS/JWT errors (misconfigured service_role).
 */
export function serviceRoleKeyTroubleshootingHint(apiMessage: string): string | null {
  const m = apiMessage.toLowerCase();
  if (!m.includes("jws") && !m.includes("jwt") && !m.includes("token") && !m.includes("signature")) {
    return null;
  }
  return [
    "Supabase rejected the API key (not a valid JWT for this project).",
    "Fix: In Supabase Dashboard → Project Settings → API, copy the **service_role** key under **Project API keys** (the long **secret** value, usually starting with eyJ).",
    "Set `SUPABASE_SERVICE_ROLE_KEY` in `.env` with no quotes and no line breaks. It must be from the **same project** as `NEXT_PUBLIC_SUPABASE_URL`.",
    "Do not use the anon key, JWT secret, or a key from a different Supabase project.",
  ].join(" ");
}

/**
 * Server-only Supabase client with the service role key (bypasses RLS).
 * Use only in trusted API routes after admin auth. Returns null if not configured.
 */
export function getSupabaseServiceRole(): SupabaseClient | null {
  const url = normalizeSupabaseSecret(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = normalizeSupabaseSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getPriceBookStorageBucket(): string {
  return (process.env.SUPABASE_PRICE_BOOK_BUCKET ?? "price-books").trim() || "price-books";
}
