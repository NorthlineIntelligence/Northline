import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { DocumentUploadPanel } from "@/components/workbench/DocumentUploadPanel";
import { StatusPill, WbCard, formatBytes, formatDate } from "@/components/workbench/ui";
import { MOCK_DOCUMENTS, getClientName } from "@/lib/workbench/mockData";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

function docStatusTone(s: string): "success" | "warning" | "danger" | "neutral" {
  if (s === "Indexed") return "success";
  if (s === "Processing") return "warning";
  if (s === "Failed") return "danger";
  return "neutral";
}

export default function DocumentsPage() {
  return (
    <WorkbenchShell
      title="Documents"
      subtitle="Secure uploads with processing pipeline placeholders for parse, chunk, and embed."
    >
      <DocumentUploadPanel />

      <WbCard className="mt-8">
        <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>All documents</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs font-black uppercase tracking-wide" style={{ borderColor: WB.border, color: WB.greyBlue }}>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Client</th>
                <th className="py-2 pr-4">Uploaded</th>
                <th className="py-2 pr-4">Size</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_DOCUMENTS.map((d) => (
                <tr key={d.id} className="border-b" style={{ borderColor: WB.border }}>
                  <td className="py-3 pr-4 font-semibold" style={{ color: WB.dark }}>{d.name}</td>
                  <td className="py-3 pr-4 font-medium" style={{ color: WB.muted }}>{d.fileType}</td>
                  <td className="py-3 pr-4 font-medium" style={{ color: WB.muted }}>{getClientName(d.clientId)}</td>
                  <td className="py-3 pr-4 font-medium" style={{ color: WB.muted }}>{formatDate(d.uploadedAt)}</td>
                  <td className="py-3 pr-4 font-medium" style={{ color: WB.muted }}>{formatBytes(d.sizeBytes)}</td>
                  <td className="py-3"><StatusPill label={d.processingStatus} tone={docStatusTone(d.processingStatus)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs font-medium" style={{ color: WB.muted }}>
          Future: chunk count → Qdrant collection per client workspace.
        </p>
      </WbCard>
    </WorkbenchShell>
  );
}
