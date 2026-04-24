type MakeEvent = {
  event_type: string;
  organization_id: string;
  organization_name: string;
  organization_folder_name: string;
  source_type?: string;
  source_id?: string;
  filename?: string;
  mime_type?: string;
  file_base64?: string;
  text_preview?: string;
  created_at: string;
};

function getWebhookUrl(): string | null {
  const url = process.env.MAKE_LIBRARY_WEBHOOK_URL;
  const trimmed = String(url || "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildOrgFolderName(orgName: string, orgId: string): string {
  const safe = orgName.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${safe || "Organization"} - ${orgId.slice(0, 8)}`;
}

export async function sendMakeLibraryEvent(input: Omit<MakeEvent, "organization_folder_name" | "created_at">) {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) return;
  const payload: MakeEvent = {
    ...input,
    organization_folder_name: buildOrgFolderName(input.organization_name, input.organization_id),
    created_at: new Date().toISOString(),
  };
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // best-effort webhook; never fail primary workflow
  }
}
