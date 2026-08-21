import { Injectable } from "@nestjs/common";
import type { TimelineEntityType, ExtensionAttribution } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

const userSelect = { id: true, fullName: true, email: true };

@Injectable()
export class TimelineExtensionsService {
  constructor(private readonly prisma: PrismaService) {}

  listByEntity(entityType: TimelineEntityType, entityId: string) {
    return this.prisma.timelineExtension.findMany({
      where: { entityType, entityId },
      include: { creator: { select: userSelect } },
      orderBy: { createdAt: "desc" },
    });
  }

  // Called from ProjectsService/TasksService's own update() when a date moves later than its
  // previous value — not exposed as its own write endpoint. Recording one only requires whatever
  // write access the caller already has on the underlying project/task.
  create(params: {
    entityType: TimelineEntityType;
    entityId: string;
    previousDate: Date;
    newDate: Date;
    reason: string;
    attributedTo: ExtensionAttribution;
    createdBy: string;
  }) {
    return this.prisma.timelineExtension.create({ data: params });
  }
}
