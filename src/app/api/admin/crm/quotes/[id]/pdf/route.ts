import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { renderQuotePdfBuffer } from "@/lib/crmQuotePdf";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const quote = await prisma.crmQuote.findUnique({
    where: { id: parsed.data.id },
  });

  if (!quote) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: quote.organization_id },
  });

  if (!organization) {
    return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
  }

  const [signee, billing] = await Promise.all([
    quote.signee_contact_id
      ? prisma.orgContact.findFirst({
          where: { id: quote.signee_contact_id, organization_id: quote.organization_id },
        })
      : null,
    quote.billing_contact_id
      ? prisma.orgContact.findFirst({
          where: { id: quote.billing_contact_id, organization_id: quote.organization_id },
        })
      : null,
  ]);

  const pdf = await renderQuotePdfBuffer({
    quote,
    organization,
    signee,
    billing,
  });

  const filename = `northline-quote-${parsed.data.id.slice(0, 8)}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
