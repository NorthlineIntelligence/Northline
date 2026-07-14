"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";
import { GovernanceIndicators } from "./GovernanceIndicators";

const NAV_ITEMS = [
  { href: "/admin/workbench", label: "Dashboard", exact: true },
  { href: "/admin/workbench/clients", label: "Clients" },
  { href: "/admin/workbench/documents", label: "Documents" },
  { href: "/admin/workbench/analysis", label: "AI Analysis" },
  { href: "/admin/workbench/outputs", label: "Outputs" },
  { href: "/admin/workbench/settings", label: "LLM Settings" },
  { href: "/admin/workbench/audit", label: "Audit Log" },
] as const;

export function WorkbenchShell({
  children,
  title,
  subtitle,
  actions,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen" style={{ color: WB.text }}>
      <aside
        className="hidden w-60 shrink-0 flex-col border-r lg:flex"
        style={{
          background: WB.sidebar,
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <div className="border-b px-5 py-6" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div
            className="text-[10px] font-black uppercase tracking-[0.14em]"
            style={{ color: WB.cyan }}
          >
            Northline Intelligence
          </div>
          <div className="mt-1 text-lg font-black tracking-tight text-white">
            Private AI Workbench
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const active =
              "exact" in item && item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-xl px-3 py-2.5 text-sm font-semibold transition"
                style={{
                  color: active ? "#fff" : WB.sidebarText,
                  background: active ? WB.sidebarActive : "transparent",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t px-4 py-4" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <Link
            href="/admin/dashboard"
            className="text-xs font-semibold hover:underline"
            style={{ color: WB.cyan }}
          >
            ← Admin home
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col" style={{ background: WB.bg }}>
        <header
          className="border-b px-4 py-4 sm:px-8 lg:hidden"
          style={{ borderColor: WB.border, background: WB.card }}
        >
          <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
            Private AI Workbench
          </div>
          <select
            className="mt-2 w-full rounded-xl border px-3 py-2 text-sm font-semibold"
            style={{ borderColor: WB.border, color: WB.dark }}
            value={pathname}
            onChange={(e) => {
              window.location.href = e.target.value;
            }}
          >
            {NAV_ITEMS.map((item) => (
              <option key={item.href} value={item.href}>
                {item.label}
              </option>
            ))}
          </select>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {(title || actions) && (
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                {title && (
                  <h1 className="text-2xl font-black tracking-tight" style={{ color: WB.dark }}>
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="mt-1 max-w-2xl text-sm font-medium leading-relaxed" style={{ color: WB.muted }}>
                    {subtitle}
                  </p>
                )}
              </div>
              {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
            </div>
          )}

          <GovernanceIndicators className="mb-6" />
          {children}
        </main>
      </div>
    </div>
  );
}
