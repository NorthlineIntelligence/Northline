"use client";

import { useEffect, useRef, useState } from "react";
import { NORTHLINE_BRAND as BRAND } from "@/lib/northlineBrand";
import { sanitizeConsultantNotesHtml } from "@/lib/priorityDiscovery/sanitizeConsultantNotesHtml";

type ConsultantNotesPanelProps = {
  analysisId: string;
  assessmentId: string;
  initialHtml: string | null;
  onSaved: (html: string | null) => void;
};

type ToolbarAction = "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList" | "formatBlock";

export function ConsultantNotesPanel(props: ConsultantNotesPanelProps) {
  const [open, setOpen] = useState(Boolean(props.initialHtml));
  const [editing, setEditing] = useState(false);
  const [html, setHtml] = useState(props.initialHtml);
  const [draftHtml, setDraftHtml] = useState(props.initialHtml ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHtml(props.initialHtml);
    setDraftHtml(props.initialHtml ?? "");
    if (props.initialHtml) setOpen(true);
  }, [props.initialHtml, props.analysisId]);

  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.innerHTML = draftHtml;
      editorRef.current.focus();
    }
  }, [editing, draftHtml]);

  function runCommand(command: ToolbarAction, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setDraftHtml(editorRef.current.innerHTML);
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const pastedHtml = event.clipboardData.getData("text/html");
    const pastedText = event.clipboardData.getData("text/plain");

    if (!pastedHtml && !pastedText) return;

    event.preventDefault();
    const sanitized =
      sanitizeConsultantNotesHtml(pastedHtml) ??
      sanitizeConsultantNotesHtml(
        pastedText
          .split(/\n{2,}/g)
          .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
          .join("")
      );

    if (!sanitized) return;

    document.execCommand("insertHTML", false, sanitized);
    if (editorRef.current) {
      setDraftHtml(editorRef.current.innerHTML);
    }
  }

  function startEditing() {
    setOpen(true);
    setEditing(true);
    setMessage(null);
    setDraftHtml(html ?? "");
  }

  function cancelEditing() {
    setEditing(false);
    setDraftHtml(html ?? "");
    setMessage(null);
  }

  async function saveNotes() {
    const raw = editorRef.current?.innerHTML ?? draftHtml;
    const sanitized = sanitizeConsultantNotesHtml(raw);
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/priority-discovery/assessments/${props.assessmentId}/analysis`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisId: props.analysisId,
          consultantNotesHtml: sanitized,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMessage(json?.error ?? `Save failed (${res.status}).`);
        setSaving(false);
        return;
      }

      setHtml(json.consultantNotesHtml ?? null);
      setDraftHtml(json.consultantNotesHtml ?? "");
      props.onSaved(json.consultantNotesHtml ?? null);
      setEditing(false);
      setOpen(true);
      setMessage("Consultant notes saved.");
      setSaving(false);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      setMessage(`Save failed: ${detail}`);
      setSaving(false);
    }
  }

  async function removeNotes() {
    if (!window.confirm("Remove consultant notes from this readout?")) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/priority-discovery/assessments/${props.assessmentId}/analysis`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisId: props.analysisId,
          consultantNotesHtml: null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMessage(json?.error ?? `Remove failed (${res.status}).`);
        setSaving(false);
        return;
      }

      setHtml(null);
      setDraftHtml("");
      props.onSaved(null);
      setEditing(false);
      setOpen(false);
      setMessage("Consultant notes removed.");
      setSaving(false);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      setMessage(`Remove failed: ${detail}`);
      setSaving(false);
    }
  }

  if (!open && !html) {
    return (
      <div className="no-print mt-6">
        <button
          type="button"
          onClick={startEditing}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold shadow-sm"
          style={{ borderColor: BRAND.border, color: BRAND.dark }}
        >
          Add Consultant Notes
        </button>
      </div>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.14em]" style={{ color: BRAND.cyan }}>
            Consultant notes
          </div>
          <h2 className="mt-2 text-xl font-semibold">Northline Consultant Commentary</h2>
          <p className="mt-1 text-sm font-medium" style={{ color: BRAND.greyBlue }}>
            Add formatted commentary for client delivery. Paste directly from Google Docs to keep headings, bullets, and emphasis.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          {!editing ? (
            <>
              <button
                type="button"
                onClick={startEditing}
                className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold"
                style={{ borderColor: BRAND.border }}
              >
                {html ? "Edit Notes" : "Add Notes"}
              </button>
              {html ? (
                <button
                  type="button"
                  onClick={removeNotes}
                  disabled={saving}
                  className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold"
                  style={{ borderColor: "#FECDCA", color: "#B42318" }}
                >
                  Remove
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={saveNotes}
                disabled={saving}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-white"
                style={{ background: saving ? "#98a2b3" : BRAND.dark }}
              >
                {saving ? "Saving..." : "Save Notes"}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold"
                style={{ borderColor: BRAND.border }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {message ? (
        <div className="no-print mt-4 rounded-xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: BRAND.border }}>
          {message}
        </div>
      ) : null}

      {editing ? (
        <div className="no-print mt-4">
          <div className="flex flex-wrap gap-2 rounded-t-xl border border-b-0 bg-[#F9FAFB] p-2" style={{ borderColor: BRAND.border }}>
            <ToolbarButton label="Bold" onClick={() => runCommand("bold")} />
            <ToolbarButton label="Italic" onClick={() => runCommand("italic")} />
            <ToolbarButton label="Underline" onClick={() => runCommand("underline")} />
            <ToolbarButton label="Bullets" onClick={() => runCommand("insertUnorderedList")} />
            <ToolbarButton label="Numbers" onClick={() => runCommand("insertOrderedList")} />
            <ToolbarButton label="Heading" onClick={() => runCommand("formatBlock", "h3")} />
            <ToolbarButton label="Paragraph" onClick={() => runCommand("formatBlock", "p")} />
          </div>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={() => setDraftHtml(editorRef.current?.innerHTML ?? "")}
            onPaste={handlePaste}
            className="min-h-[220px] rounded-b-xl border px-4 py-4 text-sm leading-7 outline-none"
            style={{ borderColor: BRAND.border, color: BRAND.text }}
          />
          <div className="mt-2 text-xs font-medium" style={{ color: BRAND.greyBlue }}>
            Tip: copy from Google Docs and paste here to preserve formatting.
          </div>
        </div>
      ) : html ? (
        <div
          className="consultant-notes-content mt-4 text-sm leading-7"
          style={{ color: BRAND.text }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="mt-4 rounded-xl border border-dashed p-5 text-sm font-medium" style={{ borderColor: BRAND.border, color: BRAND.greyBlue }}>
          No consultant notes yet.
        </div>
      )}

      <style>{`
        .consultant-notes-content h1,
        .consultant-notes-content h2,
        .consultant-notes-content h3,
        .consultant-notes-content h4 {
          margin-top: 1rem;
          margin-bottom: 0.5rem;
          font-weight: 700;
          color: ${BRAND.dark};
        }
        .consultant-notes-content p,
        .consultant-notes-content div {
          margin-bottom: 0.75rem;
        }
        .consultant-notes-content ul,
        .consultant-notes-content ol {
          margin: 0.75rem 0 0.75rem 1.25rem;
        }
        .consultant-notes-content li {
          margin-bottom: 0.35rem;
        }
        .consultant-notes-content blockquote {
          margin: 0.75rem 0;
          padding-left: 1rem;
          border-left: 3px solid ${BRAND.cyan};
          color: ${BRAND.greyBlue};
        }
        .consultant-notes-content a {
          color: ${BRAND.cyan};
          text-decoration: underline;
        }
      `}</style>
    </section>
  );
}

function ToolbarButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-md border bg-white px-2.5 py-1.5 text-xs font-semibold"
      style={{ borderColor: BRAND.border, color: BRAND.dark }}
    >
      {props.label}
    </button>
  );
}
