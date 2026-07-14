import "dotenv/config";
import { processDueScheduledInvites } from "../src/lib/scheduledInvites";

async function main() {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  const result = await processDueScheduledInvites(origin);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
