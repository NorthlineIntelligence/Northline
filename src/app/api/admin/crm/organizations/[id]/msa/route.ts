import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id." }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      name: true,
      legal_name: true,
      legal_entity_type: true,
      ein: true,
      legal_address: true,
      billing_email: true,
      crm_quotes: {
        orderBy: { updated_at: "desc" },
        take: 25,
        select: { id: true, status: true, total_cents: true, updated_at: true },
      },
      crm_contracts: {
        orderBy: { updated_at: "desc" },
        take: 25,
        select: { id: true, title: true, status: true, updated_at: true },
      },
      crm_msas: {
        orderBy: { updated_at: "desc" },
        take: 25,
        select: {
          id: true,
          title: true,
          status: true,
          version_number: true,
          terms_version: true,
          source_quote_id: true,
          accepted_by_name: true,
          accepted_by_email: true,
          accepted_at: true,
          updated_at: true,
          created_at: true,
        },
      },
    },
  });

  if (!org) {
    return NextResponse.json({ ok: false, error: "Organization not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, organization: org });
}

