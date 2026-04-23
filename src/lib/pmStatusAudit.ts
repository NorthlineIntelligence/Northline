export function encodeWhyWithTransition(args: {
  whyText?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
}) {
  const from = String(args.fromStatus ?? "").trim();
  const to = String(args.toStatus ?? "").trim();
  const why = String(args.whyText ?? "").trim();
  if (!from || !to) return why || null;
  const prefix = `[${from}->${to}]`;
  return why ? `${prefix} ${why}` : prefix;
}

export function parseWhyWithTransition(raw: string | null | undefined) {
  const text = String(raw ?? "").trim();
  const m = text.match(/^\[([^\]]+?)\-\>([^\]]+?)\]\s*(.*)$/);
  if (!m) return { fromStatus: null, toStatus: null, whyText: text || null };
  return {
    fromStatus: m[1] || null,
    toStatus: m[2] || null,
    whyText: (m[3] || "").trim() || null,
  };
}

