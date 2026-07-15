import { NextRequest, NextResponse } from "next/server";
import { processDueScheduledInvites } from "@/lib/scheduledInvites";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "development") return true;
    console.error(
      "[cron/send-scheduled-invites] CRON_SECRET is not set in production; scheduled invites cannot run."
    );
    return false;
  }

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = req.headers.get("x-cron-secret")?.trim() ?? "";
  return bearer === secret || headerSecret === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    req.nextUrl.origin;

  const result = await processDueScheduledInvites(origin);
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
