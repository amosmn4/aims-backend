import { Controller, Get, Header, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Public()
@Controller("ops/health")
export class OpsHealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException(
        "Ops database is unavailable. Check backend database configuration and connectivity.",
      );
    }

    let initialized: number;
    try {
      initialized = await this.prisma.opsState.count({ where: { id: "workspace" } });
      await this.prisma.opsWeeklySettings.count();
    } catch {
      throw new ServiceUnavailableException(
        "Ops database tables are missing. Apply the Prisma migrations before starting Ops.",
      );
    }

    if (!initialized)
      throw new ServiceUnavailableException(
        "Ops is not initialized. Run `npm run ops:bootstrap -- EXISTING_ADMIN_EMAIL` once.",
      );

    return { status: "ready" };
  }
}
