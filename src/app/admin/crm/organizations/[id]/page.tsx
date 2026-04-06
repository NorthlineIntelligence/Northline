import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import CrmOrganizationClient from "./CrmOrganizationClient";

const ParamsSchema = z.object({ id: z.string().uuid() });

export default async function CrmOrganizationPage(context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return (
      <div className="p-8 text-sm font-semibold text-red-700">Invalid organization id.</div>
    );
  }

  return <CrmOrganizationClient organizationId={parsed.data.id} />;
}
