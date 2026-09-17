import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { FinanceReportsService } from "./finance-reports.service";
import { CreateFinanceReportDto } from "./dto/create-finance-report.dto";
import { UpdateReportStatusDto } from "./dto/update-report-status.dto";
import { UpdateFinanceReportDto } from "./dto/update-finance-report.dto";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Controller("finance-reports")
@Roles("finance")
export class FinanceReportsController {
  constructor(private readonly financeReportsService: FinanceReportsService) {}

  @Get()
  findAll() {
    return this.financeReportsService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.financeReportsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateFinanceReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financeReportsService.create(dto, user.id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateFinanceReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeReportsService.update(id, dto, user);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateReportStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeReportsService.updateStatus(id, dto, user);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.financeReportsService.remove(id, user);
  }

  @Get(":id/comments")
  findComments(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.financeReportsService.findComments(id, user);
  }

  @Post(":id/comments")
  addComment(
    @Param("id") id: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeReportsService.addComment(id, dto.body, user, dto.parentId);
  }
}
