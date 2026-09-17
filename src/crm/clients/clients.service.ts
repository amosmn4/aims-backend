import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import { billingViewerCodes } from "../../common/department-scope";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateClientDto } from "./dto/create-client.dto";
import type { UpdateClientDto } from "./dto/update-client.dto";
import type { CreateContactDto } from "./dto/create-contact.dto";
import type { UpdateContactDto } from "./dto/update-contact.dto";

type ClientWithWork = {
  contracts: { status: string; billingFrequency: string }[];
  projects: { status: string; engagementType: string }[];
} & Record<string, unknown>;

/** Relationship (recurring / one-off) and lifecycle (active / past / prospect) from the client's work. */
function clientState(contracts: ClientWithWork["contracts"], projects: ClientWithWork["projects"]) {
  const liveContracts = contracts.filter((c) => c.status === "active" || c.status === "on_hold");
  const liveProjects = projects.filter((p) => ["planning", "active", "on_hold"].includes(p.status));
  const hasWork = contracts.length > 0 || projects.length > 0;
  const lifecycle =
    liveContracts.length || liveProjects.length ? "active" : hasWork ? "past" : "prospect";
  const recurring =
    contracts.some((c) => c.billingFrequency !== "one_off") ||
    projects.some((p) => p.engagementType === "ongoing");
  const relationship = !hasWork ? "none" : recurring ? "recurring" : "one_off";
  return {
    lifecycle,
    relationship,
    contractCount: contracts.length,
    projectCount: projects.length,
  };
}

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  // A client is "in scope" for a department-scoped viewer when that department captured it, or it
  // has a contract/tender/client request/project there. Operations/Tender see every client
  // (intake ownership, same exception as Client Requests).
  private async scopeWhere(viewer: AuthenticatedUser) {
    const deptCodes = await billingViewerCodes(viewer, this.prisma);
    const unrestricted =
      deptCodes === null || deptCodes.includes("operations") || deptCodes.includes("tender");
    return unrestricted
      ? undefined
      : {
          OR: [
            { department: { code: { in: deptCodes! } } },
            { contracts: { some: { department: { code: { in: deptCodes! } } } } },
            { tenders: { some: { department: { code: { in: deptCodes! } } } } },
            { clientRequests: { some: { department: { code: { in: deptCodes! } } } } },
            { projects: { some: { department: { code: { in: deptCodes! } } } } },
          ],
        };
  }

  async findAll(
    filters: { industry?: string; segment?: string; q?: string } = {},
    pagination: PaginationQueryDto = {},
    viewer: AuthenticatedUser,
  ) {
    const scope = await this.scopeWhere(viewer);
    const result = await maybePaginate(
      this.prisma.client,
      {
        where: {
          ...(filters.industry && { industry: filters.industry }),
          ...(filters.segment && { segment: filters.segment }),
          AND: [
            filters.q
              ? {
                  OR: [
                    { name: { contains: filters.q } },
                    { code: { contains: filters.q } },
                    { contactEmail: { contains: filters.q } },
                    { contactPhone: { contains: filters.q } },
                  ],
                }
              : {},
            scope ?? {},
          ],
        },
        orderBy: { name: "asc" },
        include: {
          department: { select: { id: true, name: true, code: true } },
          contracts: { select: { status: true, billingFrequency: true } },
          projects: { select: { status: true, engagementType: true } },
        },
      },
      pagination,
    );
    const rows = (Array.isArray(result) ? result : result.data) as unknown as ClientWithWork[];
    const withState = rows.map(({ contracts, projects, ...c }) => ({
      ...c,
      ...clientState(contracts, projects),
    }));
    return Array.isArray(result) ? withState : { ...result, data: withState };
  }

  // Distinct industry/segment values across every client in the viewer's scope — independent of
  // the industry/segment/q filters on findAll, so the filter dropdowns always list every option
  // rather than shrinking to whatever the current filter selection already narrowed to.
  async facets(viewer: AuthenticatedUser) {
    const where = await this.scopeWhere(viewer);
    const [industries, segments] = await Promise.all([
      this.prisma.client.findMany({
        where: { ...where, industry: { not: null } },
        distinct: ["industry"],
        select: { industry: true },
        orderBy: { industry: "asc" },
      }),
      this.prisma.client.findMany({
        where: { ...where, segment: { not: null } },
        distinct: ["segment"],
        select: { segment: true },
        orderBy: { segment: "asc" },
      }),
    ]);
    return {
      industries: industries.map((i) => i.industry).filter((v): v is string => !!v),
      segments: segments.map((s) => s.segment).filter((v): v is string => !!v),
    };
  }

  async create(dto: CreateClientDto, user: AuthenticatedUser) {
    if (dto.departmentId) {
      const department = await this.prisma.department.findUniqueOrThrow({
        where: { id: dto.departmentId },
      });
      await assertDepartmentAccess(department, user, this.prisma);
    }
    return this.prisma.client.create({ data: dto });
  }

  update(id: string, dto: UpdateClientDto) {
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  // Contract/Invoice both use onDelete: Restrict against Client, so a plain delete throws a raw
  // FK error the moment either exists — pre-check and name the blockers instead.
  async remove(id: string) {
    const [contractCount, invoiceCount] = await Promise.all([
      this.prisma.contract.count({ where: { clientId: id } }),
      this.prisma.invoice.count({ where: { clientId: id } }),
    ]);
    if (contractCount > 0 || invoiceCount > 0) {
      const parts: string[] = [];
      if (contractCount > 0)
        parts.push(`${contractCount} contract${contractCount === 1 ? "" : "s"}`);
      if (invoiceCount > 0) parts.push(`${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}`);
      throw new BadRequestException(
        `Can't delete this client — it still has ${parts.join(" and ")}.`,
      );
    }
    return this.prisma.client.delete({ where: { id } });
  }

  listContacts(clientId: string) {
    return this.prisma.clientContact.findMany({
      where: { clientId },
      orderBy: { isPrimary: "desc" },
    });
  }

  createContact(clientId: string, dto: CreateContactDto) {
    return this.prisma.clientContact.create({ data: { ...dto, clientId } });
  }

  updateContact(contactId: string, dto: UpdateContactDto) {
    return this.prisma.clientContact.update({ where: { id: contactId }, data: dto });
  }

  removeContact(contactId: string) {
    return this.prisma.clientContact.delete({ where: { id: contactId } });
  }
}
