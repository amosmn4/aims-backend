import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import type { CreateClientDto } from "./dto/create-client.dto";
import type { UpdateClientDto } from "./dto/update-client.dto";
import type { CreateContactDto } from "./dto/create-contact.dto";
import type { UpdateContactDto } from "./dto/update-contact.dto";

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(pagination: PaginationQueryDto = {}) {
    return maybePaginate(this.prisma.client, { orderBy: { name: "asc" } }, pagination);
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
      if (contractCount > 0) parts.push(`${contractCount} contract${contractCount === 1 ? "" : "s"}`);
      if (invoiceCount > 0) parts.push(`${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}`);
      throw new BadRequestException(`Can't delete this client — it still has ${parts.join(" and ")}.`);
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
