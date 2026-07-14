import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { AnalysisCenter } from "@/components/workbench/AnalysisCenter";

export default function AnalysisPage() {
  return (
    <WorkbenchShell
      title="AI Analysis Center"
      subtitle="Select client context, documents, and analysis type. Powered by private LLM when configured."
    >
      <AnalysisCenter />
    </WorkbenchShell>
  );
}
