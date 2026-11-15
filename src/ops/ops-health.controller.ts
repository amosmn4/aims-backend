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
      const initialized = await this.prisma.opsState.count({ where: { id: "workspace" } });
      await this.prisma.opsWeeklySettings.count();
      if (!initialized) throw new Error("Ops setup required");
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException(
        "Ops is not ready. Check database migrations and initialization.",
      );
    }
  }
}
