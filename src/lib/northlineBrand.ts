/**
 * Shared Northline Intelligence visual tokens (participant + reporting surfaces).
 * Import alongside next/font Montserrat + Open Sans in each page.
 */
export const NORTHLINE_BRAND = {
  dark: "#173464",
  cyan: "#34b0b4",
  greyBlue: "#66819e",
  lightAzure: "#cdd8df",
  lightBlue: "#fcfcfe",
  bg: "#fcfcfe",
  card: "#FFFFFF",
  border: "#E6EAF2",
  text: "#0B1220",
  muted: "#4B5565",
  surfaceMuted: "#f3f6fb",
  danger: "#b42318",
  /** Alias for muted section backgrounds (reports / scope UI) */
  wash: "#f3f6fb",
} as const;

export const NORTHLINE_SHELL_BG = `radial-gradient(ellipse 100% 80% at 100% -10%, rgba(52, 176, 180, 0.11) 0%, transparent 55%),
  radial-gradient(ellipse 80% 60% at -5% 100%, rgba(23, 52, 100, 0.08) 0%, transparent 48%),
  ${NORTHLINE_BRAND.lightBlue}`;

/** Inline style object for glass cards (spread into style={{ ... }}) */
export const NORTHLINE_GLASS_CARD = {
  background: "rgba(255, 255, 255, 0.92)",
  backdropFilter: "saturate(160%) blur(14px)",
  WebkitBackdropFilter: "saturate(160%) blur(14px)",
  border: "1px solid rgba(205, 216, 223, 0.65)",
  boxShadow: "0 4px 28px rgba(23, 52, 100, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04)",
} as const;

/** Prisma Department enum values participants may claim (excludes ALL). */
export const PARTICIPANT_DEPARTMENT_CODES = [
  "SALES",
  "MARKETING",
  "CUSTOMER_SUCCESS",
  "OPS",
  "REVOPS",
  "ENGINEERING",
  "PRODUCT",
  "GTM",
] as const;

export type ParticipantDepartmentCode = (typeof PARTICIPANT_DEPARTMENT_CODES)[number];
