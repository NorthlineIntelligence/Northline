import { NextRequest } from "next/server";
import { supabaseServer } from "./supabaseServer";

function parseAdminEmails(): Set<string> {
  const raw = process.env.NORTHLINE_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { ok: false as const, status: 401, message: "Missing bearer token" };
  }

  const token = authHeader.slice("bearer ".length).trim();

  const { data, error } = await supabaseServer.auth.getUser(token);

  // IMPORTANT: return the actual error message for debugging
  if (error || !data?.user?.email) {
    return {
      ok: false as const,
      status: 401,
      message: `Invalid token${error?.message ? `: ${error.message}` : ""}`,
    };
  }

  const admins = parseAdminEmails();
  const email = data.user.email.toLowerCase();

  if (!admins.has(email)) {
    return { ok: false as const, status: 403, message: "Not an admin" };
  }

  return { ok: true as const, user: data.user };
}