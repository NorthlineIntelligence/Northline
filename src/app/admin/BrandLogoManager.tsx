"use client";

import { useEffect, useState } from "react";

export default function BrandLogoManager() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/branding/logo", { credentials: "include" });
    const json = await res.json().catch(() => null);
    if (res.ok) setLogoUrl(json?.logo_data_url ?? null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onUpload(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/admin/branding/logo", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Upload failed");
      setLogoUrl(json?.logo_data_url ?? null);
      setMsg("Logo updated.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/branding/logo", {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Could not remove logo");
      setLogoUrl(null);
      setMsg("Logo removed.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm">
      <div className="text-base font-semibold">Customer-facing logo</div>
      <div className="mt-1 text-sm text-[#66819e]">
        Appears on assessment pages, executive insights, project scope, and quote materials.
      </div>
      <div className="mt-1 text-xs font-medium text-[#66819e]">
        Recommended: transparent PNG around 1200x300 (or similar wide ratio), max 1MB.
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow cursor-pointer">
          Upload logo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy || !logoUrl}
          onClick={() => void onRemove()}
          className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow disabled:opacity-50"
        >
          Remove logo
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRemove()}
          className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow disabled:opacity-50"
        >
          Reset to Northline default
        </button>
      </div>
      {logoUrl ? (
        <div className="mt-4 rounded-xl border border-[#e9eef4] bg-[#f8fafc] p-3">
          <img src={logoUrl} alt="Customer-facing logo preview" className="h-14 w-auto object-contain" />
        </div>
      ) : null}
      {msg ? <div className="mt-3 text-sm font-medium text-[#173464]">{msg}</div> : null}
    </div>
  );
}

