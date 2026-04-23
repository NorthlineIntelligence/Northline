import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";

interface PageProps {
  params: Promise<{
    id?: string;
  }>;
}

export default async function OrganizationSettingsPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;
  if (!id) notFound();
  redirect(`/admin/crm/organizations/${id}`);
}