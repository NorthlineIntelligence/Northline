/**
 * Replace a known legal/org display name with a neutral phrase before sending text to an external LLM.
 * Best-effort only; does not catch names embedded in creative spellings.
 */
export function redactLegalNameFromString(
  text: string | null | undefined,
  name: string | null | undefined
): string | null {
  const t = (text ?? "").trim();
  const n = (name ?? "").trim();
  if (!t) return null;
  if (!n || n.length < 3) return t;
  try {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = t.replace(new RegExp(escaped, "gi"), "the organization");
    const out = next.trim();
    return out || null;
  } catch {
    return t;
  }
}
