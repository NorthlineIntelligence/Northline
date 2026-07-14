import Link from "next/link";
import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { StatCard, WbButton, WbCard, formatDate } from "@/components/workbench/ui";
import { getDashboardStats, MOCK_ACTIVITY } from "@/lib/workbench/mockData";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

export default function WorkbenchDashboardPage() {
  const stats = getDashboardStats();

  const quickActions = [
    { label: "Create Client Workspace", href: "/admin/workbench/clients/new" },
    { label: "Upload Documents", href: "/admin/workbench/documents" },
    { label: "Run Assessment", href: "/admin/workbench/analysis" },
    { label: "Generate Executive Readout", href: "/admin/workbench/outputs" },
  ];

  return (
    <WorkbenchShell
      title="Private AI Workbench"
      subtitle="Secure consulting workspace for client documents, AI analysis, and executive-ready outputs."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total clients" value={stats.totalClients} />
        <StatCard label="Uploaded documents" value={stats.uploadedDocuments} />
        <StatCard label="Completed assessments" value={stats.completedAssessments} />
        <StatCard label="Draft executive reports" value={stats.draftExecutiveReports} hint="Awaiting review" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <WbCard className="lg:col-span-1">
          <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
            Quick actions
          </h2>
          <ul className="mt-4 space-y-2">
            {quickActions.map((a) => (
              <li key={a.href}>
                <Link
                  href={a.href}
                  className="block rounded-xl border px-3 py-2.5 text-sm font-black transition hover:-translate-y-[1px]"
                  style={{ borderColor: WB.border, color: WB.dark }}
                >
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </WbCard>

        <WbCard className="lg:col-span-2">
          <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
            Recent activity
          </h2>
          <ul className="mt-4 divide-y" style={{ borderColor: WB.border }}>
            {MOCK_ACTIVITY.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold" style={{ color: WB.dark }}>{item.description}</p>
                  {item.clientName && (
                    <p className="text-xs font-medium" style={{ color: WB.muted }}>{item.clientName}</p>
                  )}
                </div>
                <time className="text-xs font-medium whitespace-nowrap" style={{ color: WB.greyBlue }}>
                  {formatDate(item.timestamp)}
                </time>
              </li>
            ))}
          </ul>
        </WbCard>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        <WbButton href="/admin/workbench/clients" variant="primary">View clients</WbButton>
        <WbButton href="/admin/workbench/settings">LLM settings</WbButton>
      </div>
    </WorkbenchShell>
  );
}
