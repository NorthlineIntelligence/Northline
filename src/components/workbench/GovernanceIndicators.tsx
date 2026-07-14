import { WORKBENCH_BRAND as WB, WORKBENCH_ACCENT } from "@/lib/workbench/theme";

const ITEMS = [
  { label: "Client data isolation", detail: "Workspace-scoped storage (enforced at routing layer)" },
  { label: "Role-based access", detail: "Placeholder — connect Supabase Auth roles" },
  { label: "Audit trail", detail: "All sensitive actions logged" },
  { label: "Human approval", detail: "Required for exports & external sharing" },
] as const;

export function GovernanceIndicators({ className = "" }: { className?: string }) {
  return (
    <div
      className={`grid gap-2 sm:grid-cols-2 lg:grid-cols-4 ${className}`}
      role="status"
      aria-label="Security and governance indicators"
    >
      {ITEMS.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border px-3 py-2.5"
          style={{
            borderColor: WB.border,
            background: WB.accentMuted,
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: WORKBENCH_ACCENT }}
              aria-hidden
            />
            <span className="text-xs font-black uppercase tracking-wide" style={{ color: WB.dark }}>
              {item.label}
            </span>
          </div>
          <p className="mt-1 pl-4 text-[11px] font-medium leading-snug" style={{ color: WB.muted }}>
            {item.detail}
          </p>
        </div>
      ))}
    </div>
  );
}
