import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ClientsService } from "./clients.service";
import { CreateClientDto } from "./dto/create-client.dto";
import { UpdateClientDto } from "./dto/update-client.dto";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { parsePaginationQuery } from "../../common/pagination";

@Controller("clients")
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @Roles()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("industry") industry?: string,
    @Query("segment") segment?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.clientsService.findAll(
      { industry, segment, q },
      parsePaginationQuery(page, pageSize),
      user,
    );
  }

  @Get("facets")
  @Roles()
  facets(@CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.facets(user);
  }

  // Any department that onboards a won request/tender needs to be able to create the client
  // record inline during conversion, not just Finance — mirrors DEPT_WRITE_ROLES in
  // client-requests.controller.ts / tenders.controller.ts. Editing/removing the master record is
  // narrower (finance + hr, who own client/contract lifecycle) below.
  @Post()
  @Roles(
    "finance",
    "hr",
    "it",
    "marketing",
    "tender",
    "operations",
    "department_head",
    "account_manager",
  )
  create(@Body() dto: CreateClientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.create(dto, user);
  }

  @Patch(":id")
  @Roles("finance", "hr")
  update(@Param("id") id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Delete(":id")
  @Roles("finance", "hr")
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
