"use client";

import { useEffect, useState } from "react";

export default function BrandLogoManager() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [quoteFromName, setQuoteFromName] = useState("");
  const [quoteFromAddress, setQuoteFromAddress] = useState("");
  const [quoteFromPhone, setQuoteFromPhone] = useState("");
  const [quoteFromEmail, setQuoteFromEmail] = useState("");
  const [quotePreparedByName, setQuotePreparedByName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/branding/logo", { credentials: "include" });
    const json = await res.json().catch(() => null);
    if (res.ok) {
      setLogoUrl(json?.logo_data_url ?? null);
      setQuoteFromName(typeof json?.quote_from_name === "string" ? json.quote_from_name : "");
      setQuoteFromAddress(typeof json?.quote_from_address === "string" ? json.quote_from_address : "");
      setQuoteFromPhone(typeof json?.quote_from_phone === "string" ? json.quote_from_phone : "");
      setQuoteFromEmail(typeof json?.quote_from_email === "string" ? json.quote_from_email : "");
      setQuotePreparedByName(
        typeof json?.quote_prepared_by_name === "string" ? json.quote_prepared_by_name : ""
      );
    }
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

  async function saveQuoteFromDetails() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/branding/logo", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_from_name: quoteFromName,
          quote_from_address: quoteFromAddress,
          quote_from_phone: quoteFromPhone,
          quote_from_email: quoteFromEmail,
          quote_prepared_by_name: quotePreparedByName,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Could not save quote details");
      setMsg("Quote sender details updated.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Could not save quote details");
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
      <div className="mt-4 grid gap-3">
        <div className="text-sm font-semibold text-[#173464]">Quote "From" details</div>
        <input
          className="w-full rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] outline-none"
          placeholder="Northline name"
          value={quoteFromName}
          onChange={(e) => setQuoteFromName(e.target.value)}
          disabled={busy}
        />
        <textarea
          className="min-h-[70px] w-full rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] outline-none"
          placeholder="Northline address"
          value={quoteFromAddress}
          onChange={(e) => setQuoteFromAddress(e.target.value)}
          disabled={busy}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="w-full rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] outline-none"
            placeholder="Northline phone"
            value={quoteFromPhone}
            onChange={(e) => setQuoteFromPhone(e.target.value)}
            disabled={busy}
          />
          <input
            className="w-full rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] outline-none"
            placeholder="Northline email"
            value={quoteFromEmail}
            onChange={(e) => setQuoteFromEmail(e.target.value)}
            disabled={busy}
          />
        </div>
        <input
          className="w-full rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] outline-none"
          placeholder='Prepared by name (for quote signature)'
          value={quotePreparedByName}
          onChange={(e) => setQuotePreparedByName(e.target.value)}
          disabled={busy}
        />
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveQuoteFromDetails()}
            className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow disabled:opacity-50"
          >
            Save quote "From" details
          </button>
        </div>
      </div>
      {msg ? <div className="mt-3 text-sm font-medium text-[#173464]">{msg}</div> : null}
    </div>
  );
}

