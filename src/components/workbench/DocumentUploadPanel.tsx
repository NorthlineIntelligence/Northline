"use client";

import { useCallback, useState } from "react";
import { ACCEPTED_DOCUMENT_EXTENSIONS } from "@/lib/workbench/types";
import { MOCK_CLIENTS } from "@/lib/workbench/mockData";
import { WbButton, WbCard, StatusPill } from "./ui";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

export function DocumentUploadPanel() {
  const [clientId, setClientId] = useState(MOCK_CLIENTS[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list));
    setMessage(null);
  }, []);

  const handleUpload = async () => {
    if (!clientId || files.length === 0) {
      setMessage("Select a client and at least one file.");
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      // TODO: Supabase Storage upload + Prisma document metadata row
      await new Promise((r) => setTimeout(r, 900));
      setMessage(
        `Queued ${files.length} file(s) for processing. Future: parse → chunk → embed (Qdrant).`
      );
      setFiles([]);
    } catch {
      setMessage("Upload failed. Retry or check storage configuration.");
    } finally {
      setUploading(false);
    }
  };

  const accept = ACCEPTED_DOCUMENT_EXTENSIONS.join(",");

  return (
    <WbCard>
      <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
        Secure document upload
      </h2>
      <p className="mt-1 text-sm font-medium" style={{ color: WB.muted }}>
        PDF, DOCX, TXT, CSV, XLSX — metadata stored now; parsing and indexing connect later.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
          Client workspace
          <select
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold"
            style={{ borderColor: WB.border, color: WB.dark }}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            {MOCK_CLIENTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="text-xs font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
            Processing pipeline
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {["Uploaded", "Processing", "Indexed"].map((s) => (
              <StatusPill key={s} label={s} tone={s === "Indexed" ? "success" : "neutral"} />
            ))}
          </div>
        </div>
      </div>

      <div
        className="mt-5 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition"
        style={{ borderColor: WB.border, background: WB.surfaceMuted }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          multiple
          accept={accept}
          className="hidden"
          id="wb-doc-upload"
          onChange={(e) => onFiles(e.target.files)}
        />
        <label htmlFor="wb-doc-upload" className="cursor-pointer">
          <p className="text-sm font-black" style={{ color: WB.dark }}>
            Drop files here or click to browse
          </p>
          <p className="mt-1 text-xs font-medium" style={{ color: WB.muted }}>
            Max size limits will apply when Storage is connected
          </p>
        </label>
        {files.length > 0 && (
          <ul className="mt-4 space-y-1 text-left text-sm font-medium" style={{ color: WB.muted }}>
            {files.map((f) => (
              <li key={f.name}>{f.name}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <WbButton variant="primary" onClick={handleUpload} disabled={uploading}>
          {uploading ? "Uploading…" : "Upload & queue processing"}
        </WbButton>
        <WbButton href="/admin/workbench/documents">View all documents</WbButton>
      </div>

      {message && (
        <p className="mt-4 rounded-xl px-3 py-2 text-sm font-medium" style={{ background: WB.accentMuted, color: WB.dark }}>
          {message}
        </p>
      )}
    </WbCard>
  );
}
