import { NextResponse } from "next/server";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { sendMakeLibraryEvent } from "@/lib/makeWebhook";

export async function POST() {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  await sendMakeLibraryEvent({
    event_type: "library_document_created",
    organization_id: "00000000-0000-4000-8000-000000000001",
    organization_name: "Make Test Organization",
    source_type: "TEST_DOCUMENT",
    source_id: "make-webhook-test",
    filename: "northline-make-webhook-test.txt",
    mime_type: "text/plain",
    file_base64: Buffer.from("Northline Make webhook test file.", "utf8").toString("base64"),
    text_preview: "Northline Make webhook test file.",
  });

  return NextResponse.json({ ok: true });
}
