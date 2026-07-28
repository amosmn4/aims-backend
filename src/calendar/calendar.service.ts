import { Injectable } from "@nestjs/common";
import type { TenderStage } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type DeadlineType = "tender_submission" | "bond_expiry" | "contract_renewal" | "task_due";

export interface DeadlineItem {
  date: string;
  type: DeadlineType;
  title: string;
  to: string;
}

const OPEN_TENDER_STAGES: TenderStage[] = ["identified", "applying", "submitted", "evaluation"];

// Purely a read lens over dates that already exist on Tender/TenderBond/Contract/Task — no new
// data model, matches the original recommendation ("no schema change").
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async listDeadlines(from: Date, to: Date): Promise<DeadlineItem[]> {
    const [tenders, bonds, contracts, tasks] = await Promise.all([
      this.prisma.tender.findMany({
        where: { stage: { in: OPEN_TENDER_STAGES }, submissionDeadline: { gte: from, lte: to } },
        select: { id: true, title: true, submissionDeadline: true },
      }),
      this.prisma.tenderBond.findMany({
        where: { expiryDate: { gte: from, lte: to } },
        select: {
          id: true,
          expiryDate: true,
          bondType: true,
          tender: { select: { id: true, title: true } },
        },
      }),
      this.prisma.contract.findMany({
        where: { status: "active", endDate: { gte: from, lte: to } },
        select: { id: true, title: true, endDate: true },
      }),
      this.prisma.task.findMany({
        where: { status: { not: "completed" }, dueDate: { gte: from, lte: to } },
        select: { id: true, title: true, dueDate: true, projectId: true },
      }),
    ]);

    const items: DeadlineItem[] = [];

    for (const t of tenders) {
      if (!t.submissionDeadline) continue;
      items.push({
        date: t.submissionDeadline.toISOString().slice(0, 10),
        type: "tender_submission",
        title: `Tender submission: ${t.title}`,
        to: `/tender/${t.id}`,
      });
    }
    for (const b of bonds) {
      if (!b.expiryDate) continue;
      items.push({
        date: b.expiryDate.toISOString().slice(0, 10),
        type: "bond_expiry",
        title: `Bond expiry (${b.bondType}): ${b.tender.title}`,
        to: `/tender/${b.tender.id}`,
      });
    }
    for (const c of contracts) {
      if (!c.endDate) continue;
      items.push({
        date: c.endDate.toISOString().slice(0, 10),
        type: "contract_renewal",
        title: `Contract renewal: ${c.title}`,
        to: `/clients/contracts/${c.id}`,
      });
    }
    for (const task of tasks) {
      if (!task.dueDate) continue;
      items.push({
        date: task.dueDate.toISOString().slice(0, 10),
        type: "task_due",
        title: `Task due: ${task.title}`,
        to: `/projects/${task.projectId}`,
      });
    }

    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }
}
