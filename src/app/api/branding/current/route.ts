import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const row = await prisma.appBranding.findUnique({ where: { id: "default" } });
  return NextResponse.json({
    ok: true,
    logo_data_url: row?.logo_data_url ?? null,
  });
}

