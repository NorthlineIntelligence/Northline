"use client";

import { useState } from "react";

export default function QuoteClientActions(props: {
  quoteId: string;
  backHref: string;
}) {
  const { quoteId, backHref } = props;
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addToClientLibrary() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/crm/quotes/${quoteId}/client-library`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Could not add quote to client library");
      setMsg(json?.already_exists ? "Already in client library." : "Added to client library.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Could not add quote to client library");
    } finally {
      setSaving(false);
    }
  }

  function exportPageToPdf() {
    window.print();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={backHref} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase">
        Back to quote
      </a>
      <button
        type="button"
        onClick={exportPageToPdf}
        className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase"
      >
        Export to PDF
      </button>
      <button
        type="button"
        onClick={() => void addToClientLibrary()}
        disabled={saving}
        className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase disabled:opacity-50"
      >
        Add to client library
      </button>
      {msg ? <span className="text-xs font-semibold">{msg}</span> : null}
    </div>
  );
}
