export function quoteTotalCentsFromPayload(payload: Record<string, unknown>): number {
  let total = 0;
  const lines = Array.isArray(payload.priceBookLines) ? payload.priceBookLines : [];
  for (const row of lines) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (r.selected !== true) continue;
    const qty = typeof r.quantity === "number" && r.quantity > 0 ? r.quantity : 1;
    const unit =
      typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents)
        ? r.unit_price_cents
        : 0;
    total += Math.round(qty * unit);
  }
  const custom = Array.isArray(payload.customLines) ? payload.customLines : [];
  for (const row of custom) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const qty = typeof r.quantity === "number" && r.quantity > 0 ? r.quantity : 0;
    const unit =
      typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents)
        ? r.unit_price_cents
        : 0;
    total += Math.round(qty * unit);
  }
  return total;
}
