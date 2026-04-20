type Span = { start: number; end: number };

const ORG_SUFFIXES = new Set([
  "inc",
  "inc.",
  "llc",
  "l.l.c",
  "ltd",
  "ltd.",
  "co",
  "co.",
  "corp",
  "corp.",
  "corporation",
  "company",
  "holdings",
  "group",
]);

function normalizeToken(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = (s: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) ?? 0) + 1);
    }
    return map;
  };
  const am = bigrams(a);
  const bm = bigrams(b);
  let overlap = 0;
  for (const [bg, ac] of am.entries()) {
    const bc = bm.get(bg) ?? 0;
    overlap += Math.min(ac, bc);
  }
  return (2 * overlap) / ((a.length - 1) + (b.length - 1));
}

function mergeSpans(spans: Span[]): Span[] {
  if (spans.length === 0) return [];
  const sorted = spans.slice().sort((a, b) => a.start - b.start);
  const out: Span[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

function orgAliases(orgName: string): string[] {
  const rawTokens = orgName
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (rawTokens.length === 0) return [];

  const tokens = rawTokens.filter((t) => !ORG_SUFFIXES.has(t.toLowerCase()));
  const base = (tokens.length ? tokens : rawTokens).join(" ").trim();
  const aliases = new Set<string>();
  aliases.add(orgName.trim());
  aliases.add(base);
  const normBase = base
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean)
    .join(" ");
  if (normBase) aliases.add(normBase);
  return Array.from(aliases).filter((s) => s.length >= 3);
}

function descriptorFromIndustry(industry: string | null | undefined): string {
  const i = (industry ?? "").trim();
  if (!i) return "the company";
  const lowered = i.toLowerCase().replace(/^the\s+/i, "");
  if (lowered.includes("company")) return `the ${lowered}`;
  return `the ${lowered} company`;
}

type Token = { text: string; start: number; end: number; normalized: string };

function tokenizeWithOffsets(input: string): Token[] {
  const tokens: Token[] = [];
  const re = /[A-Za-z0-9][A-Za-z0-9&'._-]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const text = m[0];
    tokens.push({
      text,
      start: m.index,
      end: m.index + text.length,
      normalized: normalizeToken(text),
    });
  }
  return tokens;
}

/**
 * Redacts organization names from text before sending to external AI systems.
 * - Exact alias replacement (case-insensitive)
 * - Conservative fuzzy replacement for multi-token names (>=60% similarity)
 * - Single-token fuzzy replacement only at >=85% to reduce false positives
 */
export function anonymizeOrgText(args: {
  text: string | null | undefined;
  organizationName: string | null | undefined;
  industry: string | null | undefined;
}): string | null {
  const original = (args.text ?? "").replace(/\u0000/g, "");
  if (!original.trim()) return null;
  const orgName = (args.organizationName ?? "").trim();
  if (!orgName) return original.trim();

  const replacement = descriptorFromIndustry(args.industry);
  const aliases = orgAliases(orgName);
  if (aliases.length === 0) return original.trim();

  const spans: Span[] = [];

  // Exact replacements first.
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(original)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  // Fuzzy window matching.
  const tokens = tokenizeWithOffsets(original);
  const aliasNorms = aliases
    .map((a) => a.split(/\s+/).map(normalizeToken).filter(Boolean))
    .filter((parts) => parts.length > 0);

  for (const aliasParts of aliasNorms) {
    const aliasJoined = aliasParts.join("");
    const wordCount = aliasParts.length;
    for (let i = 0; i < tokens.length; i++) {
      const j = i + wordCount - 1;
      if (j >= tokens.length) break;
      const slice = tokens.slice(i, j + 1);
      const candidateJoined = slice.map((t) => t.normalized).join("");
      if (!candidateJoined) continue;
      const sim = diceSimilarity(candidateJoined, aliasJoined);
      const threshold = wordCount >= 2 ? 0.6 : 0.85;
      if (sim >= threshold) {
        spans.push({ start: slice[0].start, end: slice[slice.length - 1].end });
      }
    }
  }

  const merged = mergeSpans(spans);
  if (merged.length === 0) return original.trim();

  let out = "";
  let cursor = 0;
  for (const s of merged) {
    out += original.slice(cursor, s.start);
    out += replacement;
    cursor = s.end;
  }
  out += original.slice(cursor);
  return out.replace(/\s+/g, " ").trim() || null;
}

