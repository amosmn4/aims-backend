import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateClientDto } from "./dto/create-client.dto";
import type { UpdateClientDto } from "./dto/update-client.dto";
import type { CreateContactDto } from "./dto/create-contact.dto";
import type { UpdateContactDto } from "./dto/update-contact.dto";

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.client.findMany({ orderBy: { name: "asc" } });
  }

  create(dto: CreateClientDto) {
    return this.prisma.client.create({ data: dto });
  }

  update(id: string, dto: UpdateClientDto) {
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  remove(id: string) {
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
