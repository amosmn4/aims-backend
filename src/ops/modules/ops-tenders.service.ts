import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { PrismaService } from "../../prisma/prisma.service";
import { TendersService } from "../../crm/tenders/tenders.service";
import type { Viewer } from "../ops.schemas";

@Injectable()
export class OpsTendersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenders: TendersService,
  ) {}

  async list(viewer: Viewer) {
    return this.tenders.findAll({}, await this.authenticatedUser(viewer));
  }

  async assignees(viewer: Viewer) {
    if (viewer.role !== "ceo") throw new ForbiddenException("CEO access is required.");
    const staff = await this.prisma.opsStaff.findMany({
      where: { role: "staff", active: true, user: { isActive: true } },
      select: { name: true, user: { select: { id: true, fullName: true } } },
      orderBy: { name: "asc" },
    });
    return staff.flatMap((person) =>
      person.user ? [{ id: person.user.id, name: person.user.fullName || person.name }] : [],
    );
  }

  async assign(viewer: Viewer, tenderId: string, accountManagerId: string) {
    if (viewer.role !== "ceo") throw new ForbiddenException("CEO access is required.");
    const assignee = await this.prisma.opsStaff.findFirst({
      where: {
        userId: accountManagerId,
        role: "staff",
        active: true,
        user: { isActive: true },
      },
      select: { id: true },
    });
    if (!assignee)
      throw new BadRequestException("Choose an active staff account in the Ops workspace.");
    return this.tenders.update(tenderId, { accountManagerId }, await this.authenticatedUser(viewer));
  }

  private async authenticatedUser(viewer: Viewer): Promise<AuthenticatedUser> {
    if (!viewer.userId) throw new UnauthorizedException("A linked AIMS account is required.");
    const user = await this.prisma.user.findUnique({
      where: { id: viewer.userId },
      include: { roles: true },
    });
    if (!user?.isActive) throw new UnauthorizedException("Your AIMS account is inactive.");
    return {
      id: user.id,
      email: user.email,
      roles: user.roles.map(({ role }) => role),
      departmentId: user.departmentId,
    };
  }
}
