import type { CSSProperties, ReactNode } from "react";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBg } from "@/lib/northlineBrand";
import { ADMIN_PREMIUM_BUTTON_STYLE } from "@/lib/adminButtonStyles";

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: shellBg, color: BRAND.text }}>
      <div className="mx-auto max-w-6xl space-y-6">{children}</div>
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
      <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
        {title}
      </div>
      {subtitle ? (
        <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
          {subtitle}
        </p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide"
      style={{ borderColor: BRAND.border, background: "rgba(23,52,100,0.05)", color: BRAND.dark }}
    >
      {label}: {value}
    </div>
  );
}

export function StatusBadge({ label }: { label: string }) {
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10px] font-black uppercase"
      style={{ borderColor: BRAND.border, color: BRAND.dark, background: "#fff" }}
    >
      {label}
    </span>
  );
}

export function ActionRail({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}

export const adminPremiumActionStyle: CSSProperties = ADMIN_PREMIUM_BUTTON_STYLE;

