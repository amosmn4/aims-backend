import { Controller, Get, Query } from "@nestjs/common";
import { EngagementsService } from "./engagements.service";
import { ResolveEngagementDto } from "./dto/resolve-engagement.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

@Controller("engagements")
export class EngagementsController {
  constructor(private readonly engagementsService: EngagementsService) {}

  @Get("resolve")
  @Roles()
  resolve(@Query() dto: ResolveEngagementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.engagementsService.resolve(dto, user);
  }
}
