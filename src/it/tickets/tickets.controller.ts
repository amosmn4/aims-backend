import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { TicketsService } from "./tickets.service";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { UpdateTicketDto } from "./dto/update-ticket.dto";
import { UpdateTicketStatusDto } from "./dto/update-ticket-status.dto";
import { TicketCommentDto } from "./dto/ticket-comment.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { parsePaginationQuery } from "../../common/pagination";

// Anyone can raise and follow their own tickets; the service decides what IT-only actions need.
@Controller("tickets")
@Roles()
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("status") status?: string,
    @Query("assigneeId") assigneeId?: string,
    @Query("mine") mine?: string,
    @Query("q") q?: string,
  ) {
    return this.ticketsService.findAll(
      user,
      { status, assigneeId, mine: mine === "true", q },
      parsePaginationQuery(page, pageSize),
    );
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.create(dto, user);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.update(id, dto, user);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateTicketStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.updateStatus(id, dto, user);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.remove(id, user);
  }

  @Get(":id/comments")
  listComments(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.listComments(id, user);
  }

  @Post(":id/comments")
  addComment(
    @Param("id") id: string,
    @Body() dto: TicketCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.addComment(id, dto, user);
  }

  @Delete("comments/:commentId")
  removeComment(@Param("commentId") commentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.removeComment(commentId, user);
  }
}
