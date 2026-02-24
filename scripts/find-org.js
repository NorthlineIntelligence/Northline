const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const org = await p.organization.findFirst({ select: { id: true, name: true } });
  console.log(org ? org : "No organization found.");
  await p.$disconnect();
})();
