import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma"; // adjust if your prisma import path differs

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { organizationId } = body;

    if (!organizationId) {
      return NextResponse.json(
        { ok: false, error: "Missing organizationId" },
        { status: 400 }
      );
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { show_admin_controls: true },
    });

    if (!org) {
      return NextResponse.json(
        { ok: false, error: "Organization not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        show_admin_controls: !org.show_admin_controls,
      },
      select: {
        id: true,
        show_admin_controls: true,
      },
    });

    return NextResponse.json({
      ok: true,
      show_admin_controls: updated.show_admin_controls,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}