import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import type { TimelineEntityType } from "@prisma/client";
import { TimelineExtensionsService } from "./timeline-extensions.service";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

const ENTITY_TYPES: TimelineEntityType[] = ["project", "task", "milestone", "contract"];

@Controller("timeline-extensions")
export class TimelineExtensionsController {
  constructor(private readonly timelineExtensionsService: TimelineExtensionsService) {}

  // Same trust level as the other project sub-resource list endpoints (milestones, RAID, cost
  // items) — any authenticated user who knows the entityId, no extra re-check here.
  @Get()
  @Roles()
  list(
    @Query("entityType") entityType: string,
    @Query("entityId") entityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!ENTITY_TYPES.includes(entityType as TimelineEntityType) || !entityId) {
      throw new BadRequestException("A valid entityType and entityId are required");
    }
    return this.timelineExtensionsService.listByEntity(
      entityType as TimelineEntityType,
      entityId,
      user,
    );
  }
}
