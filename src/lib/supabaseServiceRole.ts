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
 * API keys (JWT or sb_secret) must not contain whitespace; pasted values often include line breaks.
 */
export function normalizeSupabaseApiKey(raw: string | undefined): string {
  return normalizeSupabaseSecret(raw).replace(/\s+/g, "");
}

/**
 * Hosted publishable key — wrong variable for Storage admin; use a Secret key or legacy service_role JWT.
 */
export function isLikelySupabasePublishableApiKey(key: string): boolean {
  const k = key.replace(/\s+/g, "");
  return k.startsWith("sb_publishable_");
}

export type ServiceRoleKeyTroubleshootingOpts = {
  /** True when SUPABASE_SERVICE_ROLE_KEY starts with `sb_secret_` (opaque key). Storage often still expects a JWT. */
  usingOpaqueSecret?: boolean;
};

/**
 * User-facing hint when Storage/Auth returns JWS/JWT errors (misconfigured service_role).
 */
export function serviceRoleKeyTroubleshootingHint(
  apiMessage: string,
  opts?: ServiceRoleKeyTroubleshootingOpts
): string | null {
  const m = apiMessage.toLowerCase();
  if (!m.includes("jws") && !m.includes("jwt") && !m.includes("token") && !m.includes("signature")) {
    return null;
  }
  const lines = [
    "Supabase rejected the API key for this project.",
    "For **Storage** (uploads), set `SUPABASE_SERVICE_ROLE_KEY` to the Legacy **service_role** JWT: Dashboard → Settings → API → **Legacy API keys** → **service_role** (long value with two dots, often starts with `eyJ`). `sb_secret_...` keys can trigger **Invalid Compact JWS** on Storage because the storage layer still validates a JWT-shaped key.",
    "Use one line in `.env`, no quotes, same project as `NEXT_PUBLIC_SUPABASE_URL`. Keep `sb_publishable_...` / anon only in `NEXT_PUBLIC_SUPABASE_ANON_KEY`.",
  ];
  if (opts?.usingOpaqueSecret) {
    lines.push("Your key is `sb_secret_...` — switch to the Legacy **service_role** JWT for this variable.");
  }
  return lines.join(" ");
}

/**
 * Server-only Supabase client with the service role key (bypasses RLS).
 * Use only in trusted API routes after admin auth. Returns null if not configured.
 */
export function getSupabaseServiceRole(): SupabaseClient | null {
  const url = normalizeSupabaseSecret(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = normalizeSupabaseApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getPriceBookStorageBucket(): string {
  return (process.env.SUPABASE_PRICE_BOOK_BUCKET ?? "price-books").trim() || "price-books";
}
