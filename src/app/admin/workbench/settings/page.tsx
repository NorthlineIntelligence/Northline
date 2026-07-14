import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { LlmSettingsClient } from "@/components/workbench/LlmSettingsClient";
import { getModelStatus } from "@/lib/ai/modelRouter";

export default function LlmSettingsPage() {
  const status = getModelStatus();

  return (
    <WorkbenchShell
      title="Private LLM settings"
      subtitle="Fast (Ollama 7B) and Executive (RunPod/vLLM 24B) endpoints. Configure via environment variables."
    >
      <LlmSettingsClient status={status} />
    </WorkbenchShell>
  );
}
