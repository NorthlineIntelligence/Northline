const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const assessment = await p.assessment.findFirst({ select: { id: true } });

  if (!assessment) {
    console.log("No assessment found.");
    await p.$disconnect();
    return;
  }

  const participant = await p.participant.findFirst({
    where: { assessment_id: assessment.id },
    select: { id: true, assessment_id: true },
  });

  const questions = await p.question.findMany({
    take: 2,
    select: { id: true },
  });

  console.log(
    JSON.stringify(
      {
        assessment_id: assessment.id,
        participant_id: participant ? participant.id : null,
        question_ids: questions.map((q) => q.id),
      },
      null,
      2
    )
  );

  await p.$disconnect();
})();
