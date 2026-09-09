import { Body, Controller, Get, Put, Query } from "@nestjs/common";
import { PermissionsService } from "./permissions.service";
import { SetOverrideDto } from "./dto/set-override.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

// Open to any authenticated user (empty @Roles()) — real authorization is per-department inside
// the service (admin/CEO, or a department_head acting on their own home department only).
@Controller("permissions")
@Roles()
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get("capabilities")
  listCapabilities(
    @Query("departmentId") departmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.permissions.listCapabilities(departmentId, user);
  }

  @Put("overrides")
  setOverride(@Body() dto: SetOverrideDto, @CurrentUser() user: AuthenticatedUser) {
    return this.permissions.setOverride(dto, user);
  }
}
