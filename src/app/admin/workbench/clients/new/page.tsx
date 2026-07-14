"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { WbButton, WbCard } from "@/components/workbench/ui";
import { CLIENT_STATUS_OPTIONS } from "@/lib/workbench/types";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

export default function NewClientPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [businessSize, setBusinessSize] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState(CLIENT_STATUS_OPTIONS[0]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    // TODO: Prisma create ClientWorkspace + audit log via Supabase
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    router.push("/admin/workbench/clients");
  };

  const inputCls = "mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold";
  const labelCls = "block text-xs font-black uppercase tracking-wide";

  return (
    <WorkbenchShell title="Create client workspace" subtitle="New isolated environment for client-specific AI work.">
      <WbCard className="max-w-xl">
        <label className={labelCls} style={{ color: WB.greyBlue }}>Client name
          <input className={inputCls} style={{ borderColor: WB.border, color: WB.dark }} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={`mt-4 ${labelCls}`} style={{ color: WB.greyBlue }}>Industry
          <input className={inputCls} style={{ borderColor: WB.border, color: WB.dark }} value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </label>
        <label className={`mt-4 ${labelCls}`} style={{ color: WB.greyBlue }}>Business size
          <input className={inputCls} style={{ borderColor: WB.border, color: WB.dark }} value={businessSize} onChange={(e) => setBusinessSize(e.target.value)} placeholder="e.g. Mid-Market (500–2,500)" />
        </label>
        <label className={`mt-4 ${labelCls}`} style={{ color: WB.greyBlue }}>Status
          <select className={inputCls} style={{ borderColor: WB.border, color: WB.dark }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {CLIENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className={`mt-4 ${labelCls}`} style={{ color: WB.greyBlue }}>Notes
          <textarea className={`${inputCls} min-h-[100px]`} style={{ borderColor: WB.border, color: WB.dark }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="mt-6 flex gap-2">
          <WbButton variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Create workspace"}</WbButton>
          <WbButton href="/admin/workbench/clients">Cancel</WbButton>
        </div>
      </WbCard>
    </WorkbenchShell>
  );
}
