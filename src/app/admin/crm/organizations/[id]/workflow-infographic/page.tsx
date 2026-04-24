import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import WorkflowInfographicClient from "./WorkflowInfographicClient";

const ParamsSchema = z.object({ id: z.string().uuid() });

export default async function WorkflowInfographicPage(context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return <div className="p-8 text-sm font-semibold text-red-700">Invalid organization id.</div>;
  }

  const org = await prisma.organization.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, name: true },
  });
  if (!org) {
    return <div className="p-8 text-sm font-semibold text-red-700">Organization not found.</div>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
        <h1 className="text-lg font-black text-slate-900">{org.name} - Workflow Infographic</h1>
        <Link
          href={`/admin/crm/organizations/${org.id}`}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-900"
        >
          Back to {org.name} profile
        </Link>
      </div>
      <WorkflowInfographicClient organizationId={org.id} />
    </main>
  );
}
