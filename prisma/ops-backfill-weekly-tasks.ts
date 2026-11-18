import { PrismaClient } from "@prisma/client";
import { weeklySubmissionSchema } from "../src/ops/weekly/weekly.schemas";
import { syncWeeklyTasks } from "../src/ops/weekly/weekly-tasks";

const db = new PrismaClient();
async function main() {
  const records = await db.opsWeeklyReport.findMany({
    where: { submittedAt: { not: null } },
    orderBy: [{ weekStart: "desc" }, { phase: "desc" }],
  });
  for (const row of records) {
    await db.$transaction(async (tx) => {
      await tx.opsState.update({
        where: { id: "workspace" },
        data: { revision: { increment: 1 } },
      });
      const submission = weeklySubmissionSchema.parse(row.submission);
      const plan = records.find(
        (record) =>
          record.staffId === row.staffId &&
          record.weekStart === row.weekStart &&
          record.phase === "plan",
      );
      const plannedIds = plan
        ? new Set(weeklySubmissionSchema.parse(plan.submission).items.map((item) => item.id))
        : new Set<string>();
      submission.items = submission.items.map((item) => ({
        ...item,
        source:
          item.source ??
          (plannedIds.has(item.id) ? "planned" : row.phase === "plan" ? "planned" : "ad_hoc"),
      }));
      await syncWeeklyTasks(tx, row.staffId, row.weekStart, row.phase, submission, true);
      await tx.auditLog.create({
        data: {
          action: "ops.weekly.tasks_backfilled",
          entityType: "ops-weekly",
          entityId: row.id,
          newValue: { staffId: row.staffId, weekStart: row.weekStart, phase: row.phase },
        },
      });
    });
  }
  process.stdout.write(`Processed ${records.length} submitted weekly records.\n`);
}
main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Backfill failed"}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
