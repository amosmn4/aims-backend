import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { PrismaService } from "../../prisma/prisma.service";
import { TendersService } from "../../crm/tenders/tenders.service";
import type { Viewer } from "../ops.schemas";
import { UpdateTenderDto } from "../../crm/tenders/dto/update-tender.dto";
import { UpdateTenderStageDto } from "../../crm/tenders/dto/update-tender-stage.dto";
import { CreateTenderDto } from "../../crm/tenders/dto/create-tender.dto";

@Injectable()
export class OpsTendersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenders: TendersService,
  ) {}

  async list(viewer: Viewer) {
    this.access(viewer);
    return this.tenders.findAll(
      viewer.role === "ceo" ? {} : { assignedUserId: viewer.userId! },
      await this.authenticatedUser(viewer),
    );
  }

  private access(viewer: Viewer, write = false) {
    if (viewer.role === "system_admin")
      throw new ForbiddenException("Operational access is required.");
    if (!viewer.userId) throw new UnauthorizedException("A linked AIMS account is required.");
    if (
      viewer.role !== "ceo" &&
      (!viewer.modules?.tender || (write && viewer.modules.tender !== "manage"))
    )
      throw new ForbiddenException("Tender module access is required.");
  }

  private async record(viewer: Viewer, id: string, write = false) {
    this.access(viewer, write);
    const row = await this.prisma.tender.findFirst({
      where: {
        id,
        ...(viewer.role === "ceo"
          ? {}
          : {
              OR: [
                { accountManagerId: viewer.userId! },
                { resources: { some: { userId: viewer.userId! } } },
              ],
            }),
      },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("Tender not found.");
    return this.authenticatedUser(viewer);
  }

  async detail(viewer: Viewer, id: string) {
    const user = await this.record(viewer, id);
    const [
      tender,
      resources,
      requirements,
      bonds,
      pricing,
      activities,
      financials,
      costs,
      timeEntries,
    ] = await Promise.all([
      this.tenders.findOne(id, user),
      this.tenders.listResources(id, user),
      this.tenders.listRequirements(id, user),
      this.tenders.listBonds(id, user),
      this.tenders.listPricingItems(id, user),
      this.tenders.listActivities(id, user),
      this.tenders.getFinancialsSummary(id, user),
      this.tenders.getCostSummary(id, user),
      this.tenders.listTimeEntries(id, user),
    ]);
    const documents = await this.prisma.document.findMany({
      where: { resourceType: "tender", resourceId: id },
      select: {
        id: true,
        title: true,
        category: true,
        latestVersion: { select: { versionNo: true, fileName: true } },
      },
    });
    return {
      tender: { ...tender, canEdit: viewer.role === "ceo" || viewer.modules?.tender === "manage" },
      resources,
      requirements,
      bonds,
      pricing,
      activities,
      financials,
      costs,
      timeEntries,
      documents,
    };
  }

  async document(viewer: Viewer, id: string, documentId: string) {
    await this.record(viewer, id);
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, resourceType: "tender", resourceId: id },
      include: { latestVersion: true },
    });
    if (!doc?.latestVersion) throw new NotFoundException("Document not found.");
    return doc.latestVersion;
  }

  async options(viewer: Viewer) {
    this.access(viewer);
    return {
      departments: await this.prisma.department.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    };
  }

  async create(viewer: Viewer, dto: CreateTenderDto) {
    this.access(viewer, true);
    return this.tenders.create(
      { ...dto, accountManagerId: viewer.role === "ceo" ? dto.accountManagerId : viewer.userId! },
      await this.authenticatedUser(viewer),
    );
  }

  async update(viewer: Viewer, id: string, dto: UpdateTenderDto) {
    if (dto.accountManagerId !== undefined && viewer.role !== "ceo")
      throw new ForbiddenException("Only the CEO can change tender assignments.");
    return this.tenders.update(id, dto, await this.record(viewer, id, true));
  }

  async stage(viewer: Viewer, id: string, dto: UpdateTenderStageDto) {
    return this.tenders.updateStage(id, dto, await this.record(viewer, id, true));
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
    const result = await this.tenders.update(
      tenderId,
      { accountManagerId },
      await this.authenticatedUser(viewer),
    );
    await this.prisma.opsModuleGrant.upsert({
      where: { staffId_module: { staffId: assignee.id, module: "tender" } },
      create: { staffId: assignee.id, module: "tender", access: "manage" },
      update: {},
    });
    return result;
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
      roles: viewer.role === "ceo" ? ["ceo"] : ["tender"],
      departmentId: user.departmentId,
    };
  }
}
