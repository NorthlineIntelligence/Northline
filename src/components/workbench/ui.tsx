import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";
import { ADMIN_PREMIUM_BUTTON_STYLE, ADMIN_PREMIUM_PRIMARY_BUTTON_STYLE } from "@/lib/adminButtonStyles";

export function WbCard({
  children,
  className = "",
  padding = "p-5",
}: {
  children: ReactNode;
  className?: string;
  padding?: string;
}) {
  return (
    <section
      className={`rounded-2xl border bg-white/95 shadow-sm ${padding} ${className}`}
      style={{ borderColor: WB.border }}
    >
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <WbCard>
      <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
        {label}
      </p>
      <p className="mt-2 text-3xl font-black tracking-tight" style={{ color: WB.dark }}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs font-medium" style={{ color: WB.muted }}>
          {hint}
        </p>
      ) : null}
    </WbCard>
  );
}

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  const tones: Record<string, { bg: string; color: string; border: string }> = {
    neutral: { bg: "#fff", color: WB.dark, border: WB.border },
    success: { bg: WB.accentMuted, color: WB.accent, border: "rgba(45,143,111,0.35)" },
    warning: { bg: "#fff8eb", color: "#9a6700", border: "#f5e6c8" },
    danger: { bg: "#fef3f2", color: WB.danger, border: "#fecdca" },
    accent: { bg: "rgba(52,176,180,0.12)", color: WB.cyan, border: "rgba(52,176,180,0.35)" },
  };
  const t = tones[tone];
  return (
    <span
      className="inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
      style={{ background: t.bg, color: t.color, borderColor: t.border }}
    >
      {label}
    </span>
  );
}

export function WbButton({
  children,
  href,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const style: CSSProperties =
    variant === "primary" ? ADMIN_PREMIUM_PRIMARY_BUTTON_STYLE : ADMIN_PREMIUM_BUTTON_STYLE;
  const className =
    "inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px] disabled:opacity-50 disabled:hover:translate-y-0";

  if (href) {
    return (
      <Link href={href} className={className} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={className} style={style}>
      {children}
    </button>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-12 text-center" style={{ borderColor: WB.border }}>
      <p className="text-sm font-black" style={{ color: WB.dark }}>
        {title}
      </p>
      <p className="mt-2 text-sm font-medium" style={{ color: WB.muted }}>
        {description}
      </p>
    </div>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
