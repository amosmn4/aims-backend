import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import { viewerDepartmentCodes } from "../../common/department-scope";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateClientDto } from "./dto/create-client.dto";
import type { UpdateClientDto } from "./dto/update-client.dto";
import type { CreateContactDto } from "./dto/create-contact.dto";
import type { UpdateContactDto } from "./dto/update-contact.dto";

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  // Client has no department column of its own — a client is "in scope" for a department-scoped
  // viewer when it has at least one contract/tender/client request/project belonging to one of
  // their departments. Operations/Tender additionally see every client tied only to an unrouted
  // (department-less) client request, matching the same intake-ownership exception used for
  // Client Requests themselves.
  private scopeWhere(viewer: AuthenticatedUser) {
    const deptCodes = viewerDepartmentCodes(viewer);
    const unrestricted =
      deptCodes === null || deptCodes.includes("operations") || deptCodes.includes("tender");
    return unrestricted
      ? undefined
      : {
          OR: [
            { contracts: { some: { department: { code: { in: deptCodes! } } } } },
            { tenders: { some: { department: { code: { in: deptCodes! } } } } },
            { clientRequests: { some: { department: { code: { in: deptCodes! } } } } },
            { projects: { some: { department: { code: { in: deptCodes! } } } } },
          ],
        };
  }

  findAll(
    filters: { industry?: string; segment?: string; q?: string } = {},
    pagination: PaginationQueryDto = {},
    viewer: AuthenticatedUser,
  ) {
    const scope = this.scopeWhere(viewer);
    return maybePaginate(
      this.prisma.client,
      {
        where: {
          ...(filters.industry && { industry: filters.industry }),
          ...(filters.segment && { segment: filters.segment }),
          ...(filters.q && {
            OR: [{ name: { contains: filters.q } }, { code: { contains: filters.q } }],
          }),
          ...(scope && scope),
        },
        orderBy: { name: "asc" },
      },
      pagination,
    );
  }

  // Distinct industry/segment values across every client in the viewer's scope — independent of
  // the industry/segment/q filters on findAll, so the filter dropdowns always list every option
  // rather than shrinking to whatever the current filter selection already narrowed to.
  async facets(viewer: AuthenticatedUser) {
    const where = this.scopeWhere(viewer);
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

  create(dto: CreateClientDto) {
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
