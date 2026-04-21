import { requireAdmin } from "@/lib/admin";
import CrmProjectsClient from "./CrmProjectsClient";

export default async function CrmOrganizationProjectsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  return <CrmProjectsClient organizationId={id} />;
}

