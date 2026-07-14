export async function register() {
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.DISABLE_DEV_INVITE_CRON === "1") return;

  const { processDueScheduledInvites } = await import("./lib/scheduledInvites");
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  const intervalMs = 60_000;

  async function tick() {
    try {
      const result = await processDueScheduledInvites(origin);
      if (result.processed > 0) {
        console.log(
          `[dev invite cron] processed ${result.processed} scheduled invite(s):`,
          result.results
        );
      }
    } catch (err) {
      console.error("[dev invite cron] failed:", err);
    }
  }

  void tick();
  setInterval(() => void tick(), intervalMs);
  console.log(`[dev invite cron] polling every ${intervalMs / 1000}s for due scheduled invites`);
}
