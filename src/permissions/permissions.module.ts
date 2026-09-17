import { Module } from "@nestjs/common";
import { PermissionsController } from "./permissions.controller";
import { PermissionsService } from "./permissions.service";
import { RoleCapabilitiesService } from "./role-capabilities.service";

@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService, RoleCapabilitiesService],
})
export class PermissionsModule {}
