import type { Prisma, StageEntityType } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

type Db = PrismaService | Prisma.TransactionClient;

/** Records a stage move; does nothing when the stage didn't change. */
export async function recordStageChange(
  db: Db,
  entry: {
    entityType: StageEntityType;
    entityId: string;
    from: string | null;
    to: string;
    userId?: string | null;
  },
) {
  if (entry.from === entry.to) return;
  await db.stageChange.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      fromStage: entry.from,
      toStage: entry.to,
      changedBy: entry.userId ?? null,
    },
  });
}
