"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminControlsToggleButton(props: {
  organizationId: string;
  initialEnabled: boolean;
}) {
  const { organizationId, initialEnabled } = props;

  const router = useRouter();

  const [enabled, setEnabled] = useState<boolean>(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onToggle(e: React.MouseEvent) {
    e.preventDefault(); // IMPORTANT: prevents clicking the org row link

    setSaving(true);
    setErr(null);

    try {
      const res = await fetch("/api/admin/organization/toggle-admin-controls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organizationId }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setErr(json?.error ?? `Toggle failed (${res.status})`);
        return;
      }

      const nextEnabled = Boolean(json.show_admin_controls);
      setEnabled(nextEnabled);

      // Force server components/data to re-fetch so admin-only controls appear immediately.
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button
        type="button"
        onClick={onToggle}
        disabled={saving}
        style={{
          borderRadius: 12,
          padding: "8px 10px",
          fontSize: 12,
          fontWeight: 800,
          border: "1px solid #cdd8df",
          background: enabled ? "#173464" : "#ffffff",
          color: enabled ? "#ffffff" : "#173464",
          opacity: saving ? 0.7 : 1,
          cursor: saving ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
        }}
        title="Toggles visibility of Raw JSON + Debug controls for this org"
      >
        {saving ? "Saving…" : enabled ? "Admin controls: ON" : "Admin controls: OFF"}
      </button>

      {err ? (
        <div style={{ fontSize: 11, color: "#b42318", fontWeight: 700, maxWidth: 220, textAlign: "right" }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}