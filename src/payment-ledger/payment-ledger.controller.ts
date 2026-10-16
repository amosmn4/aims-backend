import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { IsIn } from "class-validator";
import type { Response } from "express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { PaymentLedgerAccessService } from "./payment-ledger-access.service";
import { PaymentLedgerSyncService } from "./payment-ledger-sync.service";
import { PaymentLedgerService } from "./payment-ledger.service";

class SetLedgerAccessDto {
  @IsIn(["read", "write", "none"])
  level!: "read" | "write" | "none";
}

@Controller("payment-ledger")
@Roles()
export class PaymentLedgerController {
  constructor(
    private readonly ledger: PaymentLedgerService,
    private readonly access: PaymentLedgerAccessService,
    private readonly sync: PaymentLedgerSyncService,
  ) {}

  @Get("access")
  accessFor(@CurrentUser() user: AuthenticatedUser) {
    return this.access.access(user);
  }

  @Get("access/people")
  people(@CurrentUser() user: AuthenticatedUser) {
    return this.access.people(user);
  }

  @Put("access/people/:id")
  setAccess(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetLedgerAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.access.set(id, dto.level, user);
  }

  @Get("sync")
  async syncStatus(@CurrentUser() user: AuthenticatedUser) {
    await this.access.assert(user);
    return this.sync.status();
  }

  @Post("sync")
  async synchronize(@CurrentUser() user: AuthenticatedUser) {
    await this.access.assert(user, "write");
    return this.sync.sync();
  }

  @Get("entries/summary")
  summary(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, unknown>) {
    return this.ledger.summary(user, query);
  }

  @Get("entries/export")
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const csv = await this.ledger.csv(user, query);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="aims-payment-ledger.csv"');
    response.send(csv);
  }

  @Get("entries")
  entries(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, unknown>) {
    return this.ledger.list(user, query);
  }

  @Get("entries/:id")
  detail(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.ledger.detail(user, id);
  }

  @Post("entries/:id/:action")
  action(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("action") action: string,
    @Body() data: Record<string, unknown>,
  ) {
    if (!["allocate", "retry"].includes(action))
      throw new BadRequestException("Unsupported payment action");
    return this.ledger.bridge(user, `events/${id}/${action}/`, "POST", data);
  }

  @Get("meters")
  meters(
    @CurrentUser() user: AuthenticatedUser,
    @Query("search") search = "",
    @Query("paybill") paybill = "",
  ) {
    return this.ledger.bridge(user, `meters/?${new URLSearchParams({ search, paybill })}`);
  }

  @Get("applications")
  applications(@CurrentUser() user: AuthenticatedUser) {
    return this.ledger.bridge(user, "applications/");
  }

  @Post("applications")
  createApplication(@CurrentUser() user: AuthenticatedUser, @Body() data: Record<string, unknown>) {
    return this.ledger.bridge(user, "applications/", "POST", data);
  }

  @Patch("applications/:id")
  editApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() data: Record<string, unknown>,
  ) {
    return this.ledger.bridge(user, `applications/${id}/`, "PATCH", data);
  }

  @Post("applications/:id/rotate-credentials")
  rotate(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.ledger.bridge(user, `applications/${id}/`, "POST", {});
  }
}
