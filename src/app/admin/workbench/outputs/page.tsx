import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { StatusPill, WbCard } from "@/components/workbench/ui";
import { MOCK_OUTPUTS, getClientName } from "@/lib/workbench/mockData";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";
import { formatDate } from "@/components/workbench/ui";

function outputStatusTone(s: string): "neutral" | "success" | "warning" {
  if (s === "Final") return "success";
  if (s === "Reviewed") return "warning";
  return "neutral";
}

export default function OutputsPage() {
  return (
    <WorkbenchShell
      title="Output library"
      subtitle="Executive readouts, risk registers, roadmaps, and implementation plans."
    >
      <div className="grid gap-4">
        {MOCK_OUTPUTS.map((o) => (
          <WbCard key={o.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-base font-black" style={{ color: WB.dark }}>{o.title}</h3>
                <p className="mt-1 text-xs font-medium" style={{ color: WB.muted }}>
                  {getClientName(o.clientId)} · {o.type} · {formatDate(o.createdAt)}
                </p>
                <p className="mt-3 line-clamp-3 text-sm font-medium leading-relaxed" style={{ color: WB.muted }}>
                  {o.contentPreview}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                <StatusPill label={o.status} tone={outputStatusTone(o.status)} />
                <span
                  className="inline-flex rounded-2xl border px-4 py-2 text-sm font-black opacity-60"
                  style={{ borderColor: WB.border, color: WB.muted }}
                  title="Export — connect PDF/Canva later"
                >
                  Export (soon)
                </span>
              </div>
            </div>
          </WbCard>
        ))}
      </div>
    </WorkbenchShell>
  );
}
