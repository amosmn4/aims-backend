import { UseGuards } from "@nestjs/common";
import { Public } from "../../auth/decorators/public.decorator";
import { OpsAuthGuard } from "../ops-auth.guard";
import { OpsFeature, OpsModuleGuard } from "../ops-module.guard";
import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { parsePaginationQuery } from "../../common/pagination";
import { WaterExpensesService } from "../../water/water-expenses.service";
import {
  CreateWaterExpenseDto,
  UpdateWaterExpenseDto,
  PayWaterExpenseDto,
} from "../../water/dto/water-expense.dto";
@Public()
@UseGuards(OpsAuthGuard, OpsModuleGuard)
@OpsFeature("water")
@Controller("ops/water/expenses")
export class OpsWaterExpensesController {
  constructor(private readonly expenses: WaterExpensesService) {}
  @Get("summary")
  summary(
    @Query("month")
    month?: string,
  ) {
    return this.expenses.summary(month);
  }
  @Get()
  list(
    @Query("month")
    month?: string,
    @Query("category")
    category?: string,
    @Query("status")
    status?: string,
    @Query("q")
    q?: string,
    @Query("page")
    page?: string,
    @Query("pageSize")
    pageSize?: string,
  ) {
    return this.expenses.list({ month, category, status, q }, parsePaginationQuery(page, pageSize));
  }
  @Post()
  create(
    @Body()
    dto: CreateWaterExpenseDto,
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.expenses.create(dto, user.id);
  }
  @Patch(":id")
  update(
    @Param("id")
    id: string,
    @Body()
    dto: UpdateWaterExpenseDto,
  ) {
    return this.expenses.update(id, dto);
  }
  @Post(":id/pay")
  pay(
    @Param("id")
    id: string,
    @Body()
    dto: PayWaterExpenseDto,
  ) {
    return this.expenses.pay(id, dto);
  }
}
