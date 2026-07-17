import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ClientsService } from "./clients.service";
import { CreateClientDto } from "./dto/create-client.dto";
import { UpdateClientDto } from "./dto/update-client.dto";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";
import { Roles } from "../../auth/decorators/roles.decorator";

@Controller("clients")
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @Roles()
  findAll() {
    return this.clientsService.findAll();
  }

  @Post()
  @Roles("finance")
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Patch(":id")
  @Roles("finance")
  update(@Param("id") id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Delete(":id")
  @Roles("finance")
  remove(@Param("id") id: string) {
    return this.clientsService.remove(id);
  }

  // Any department can maintain contacts for a client they engage with (account management
  // crosses departments per the spec), so these are open to any authenticated user.
  @Get(":id/contacts")
  @Roles()
  listContacts(@Param("id") id: string) {
    return this.clientsService.listContacts(id);
  }

  @Post(":id/contacts")
  @Roles()
  createContact(@Param("id") id: string, @Body() dto: CreateContactDto) {
    return this.clientsService.createContact(id, dto);
  }

  @Patch("contacts/:contactId")
  @Roles()
  updateContact(@Param("contactId") contactId: string, @Body() dto: UpdateContactDto) {
    return this.clientsService.updateContact(contactId, dto);
  }

  @Delete("contacts/:contactId")
  @Roles()
  removeContact(@Param("contactId") contactId: string) {
    return this.clientsService.removeContact(contactId);
  }
}
