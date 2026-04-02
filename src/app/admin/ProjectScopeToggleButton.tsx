"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Enables the "Project Scope" entry point on Executive Insights for this org’s assessments.
 */
export default function ProjectScopeToggleButton(props: {
  organizationId: string;
  initialEnabled: boolean;
}) {
  const { organizationId, initialEnabled } = props;
  const router = useRouter();

  const [enabled, setEnabled] = useState<boolean>(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    setSaving(true);
    setErr(null);

    try {
      const res = await fetch("/api/admin/organization/toggle-project-scope", {
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

      setEnabled(Boolean(json.show_project_scope_review));
      router.refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
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
          background: enabled ? "#34b0b4" : "#ffffff",
          color: enabled ? "#173464" : "#173464",
          opacity: saving ? 0.7 : 1,
          cursor: saving ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
        }}
        title="When on, Executive Insights shows a Project Scope button for this organization"
      >
        {saving ? "Saving…" : enabled ? "Project scope: ON" : "Project scope: OFF"}
      </button>

      {err ? (
        <div
          style={{
            fontSize: 11,
            color: "#b42318",
            fontWeight: 700,
            maxWidth: 220,
            textAlign: "right",
          }}
        >
          {err}
        </div>
      ) : null}
    </div>
  );
}
