import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { StatusPill, WbCard, formatDate } from "@/components/workbench/ui";
import { MOCK_AUDIT_LOG } from "@/lib/workbench/mockData";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

function auditTone(s: string): "success" | "warning" | "danger" | "neutral" {
  if (s === "Success") return "success";
  if (s === "Requires Approval") return "warning";
  if (s === "Failed") return "danger";
  return "neutral";
}

export default function AuditLogPage() {
  return (
    <WorkbenchShell
      title="Audit log"
      subtitle="Governance trail for uploads, analysis runs, exports, and configuration changes."
    >
      <WbCard>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs font-black uppercase tracking-wide" style={{ borderColor: WB.border, color: WB.greyBlue }}>
                <th className="py-2 pr-3">Timestamp</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Client</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Object</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_AUDIT_LOG.map((row) => (
                <tr key={row.id} className="border-b" style={{ borderColor: WB.border }}>
                  <td className="py-3 pr-3 font-medium whitespace-nowrap" style={{ color: WB.muted }}>{formatDate(row.timestamp)}</td>
                  <td className="py-3 pr-3 font-semibold" style={{ color: WB.dark }}>{row.user}</td>
                  <td className="py-3 pr-3 font-medium" style={{ color: WB.muted }}>{row.clientName ?? "—"}</td>
                  <td className="py-3 pr-3 font-medium" style={{ color: WB.dark }}>{row.action}</td>
                  <td className="py-3 pr-3 font-medium" style={{ color: WB.muted }}>{row.objectType}</td>
                  <td className="py-3"><StatusPill label={row.status} tone={auditTone(row.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs font-medium" style={{ color: WB.muted }}>
          TODO: Persist audit events to PostgreSQL via Prisma; stream to compliance exports.
        </p>
      </WbCard>
    </WorkbenchShell>
  );
}
