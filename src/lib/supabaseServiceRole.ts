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
 * Legacy `service_role` keys are JWTs with three dot-separated segments (often start with "eyJ").
 */
export function isLikelySupabaseJwtApiKey(key: string): boolean {
  if (!key || key.length < 80) return false;
  const parts = key.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/**
 * Accepts either a legacy JWT `service_role` key or a hosted-platform Secret key (`sb_secret_...`).
 * See https://supabase.com/docs/guides/api/api-keys
 */
export function isLikelySupabaseServiceRoleApiKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith("sb_secret_") && key.length >= 20) return true;
  return isLikelySupabaseJwtApiKey(key);
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
    "Supabase rejected the API key for this project.",
    "Fix: Dashboard → Project Settings → API → API Keys: use a **Secret** key (`sb_secret_...`) or, under Legacy API keys, the **service_role** JWT.",
    "Set `SUPABASE_SERVICE_ROLE_KEY` in `.env` with no quotes or line breaks; must match the same project as `NEXT_PUBLIC_SUPABASE_URL`.",
    "Do not use the publishable/anon key or a key from another project.",
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
