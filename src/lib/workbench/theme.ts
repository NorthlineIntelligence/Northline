import { NORTHLINE_BRAND } from "@/lib/northlineBrand";

/** Workbench-specific accent — subtle executive green on navy shell */
export const WORKBENCH_ACCENT = "#2d8f6f";
export const WORKBENCH_ACCENT_MUTED = "rgba(45, 143, 111, 0.12)";

export const WORKBENCH_BRAND = {
  ...NORTHLINE_BRAND,
  accent: WORKBENCH_ACCENT,
  accentMuted: WORKBENCH_ACCENT_MUTED,
  sidebar: NORTHLINE_BRAND.dark,
  sidebarText: "rgba(255,255,255,0.85)",
  sidebarMuted: "rgba(255,255,255,0.55)",
  sidebarActive: "rgba(52, 176, 180, 0.22)",
} as const;
