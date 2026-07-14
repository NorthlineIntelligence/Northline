import { requireAdmin } from "@/lib/admin";

export default async function WorkbenchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return children;
}
