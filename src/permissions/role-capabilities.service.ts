import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  type OnModuleInit,
} from "@nestjs/common";
import type { AppRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import {
  CAPABILITIES,
  EDITABLE_ROLES,
  loadCapabilities,
  matrix,
  setCapabilityCache,
  type Capability,
} from "../common/capabilities";

@Injectable()
export class RoleCapabilitiesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await loadCapabilities(this.prisma);
  }

  list() {
    return { capabilities: CAPABILITIES, roles: matrix() };
  }

  async set(dto: { role: string; capability: string; allowed: boolean }, user: AuthenticatedUser) {
    if (!isAdminOrCeo(user))
      throw new ForbiddenException("Only the CEO can change what roles can do");
    const role = EDITABLE_ROLES.find((r) => r === dto.role);
    const capability = CAPABILITIES.find((c) => c.key === dto.capability)?.key;
    if (!role || !capability)
      throw new BadRequestException("Choose a role and something it can do");
    await this.prisma.roleCapability.upsert({
      where: { role_capability: { role: role as AppRole, capability } },
      create: { role: role as AppRole, capability, allowed: dto.allowed, updatedBy: user.id },
      update: { allowed: dto.allowed, updatedBy: user.id },
    });
    setCapabilityCache(role as AppRole, capability as Capability, dto.allowed);
    return this.list();
  }
}
