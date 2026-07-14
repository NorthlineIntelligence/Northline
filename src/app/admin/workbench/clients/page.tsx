import Link from "next/link";
import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { StatusPill, WbButton, WbCard } from "@/components/workbench/ui";
import { MOCK_CLIENTS } from "@/lib/workbench/mockData";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

function statusTone(status: string): "neutral" | "success" | "accent" | "warning" {
  if (status === "Complete") return "success";
  if (status === "Discovery") return "warning";
  if (status === "Implementation") return "accent";
  return "neutral";
}

export default function ClientsPage() {
  return (
    <WorkbenchShell
      title="Client workspaces"
      subtitle="Isolated environments for proprietary documents, assessments, and AI outputs."
      actions={<WbButton href="/admin/workbench/clients/new" variant="primary">+ New workspace</WbButton>}
    >
      <div className="grid gap-4">
        {MOCK_CLIENTS.map((client) => (
          <WbCard key={client.id}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Link href={`/admin/workbench/clients/${client.id}`} className="text-lg font-black hover:underline" style={{ color: WB.dark }}>
                  {client.name}
                </Link>
                <p className="mt-1 text-sm font-medium" style={{ color: WB.muted }}>
                  {client.industry} · {client.businessSize}
                </p>
                <p className="mt-2 line-clamp-2 text-sm font-medium" style={{ color: WB.muted }}>{client.notes}</p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <StatusPill label={client.status} tone={statusTone(client.status)} />
                <p className="text-xs font-medium" style={{ color: WB.greyBlue }}>
                  {client.documentIds.length} docs · {client.assessmentIds.length} assessments · {client.outputIds.length} outputs
                </p>
                <WbButton href={`/admin/workbench/clients/${client.id}`}>Open workspace</WbButton>
              </div>
            </div>
          </WbCard>
        ))}
      </div>
    </WorkbenchShell>
  );
}
