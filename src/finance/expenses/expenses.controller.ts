import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { ExpensesService } from "./expenses.service";
import { CreateExpenseDto, PayExpenseDto, UpdateExpenseDto } from "./dto/expense.dto";

@Controller("expenses")
@Roles("finance")
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("status") status?: string,
    @Query("departmentId") departmentId?: string,
    @Query("q") q?: string,
  ) {
    return this.expenses.list({ from, to, status, departmentId, q });
  }

  @Post()
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.create(dto, user.id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateExpenseDto) {
    return this.expenses.update(id, dto);
  }

  @Post(":id/pay")
  pay(@Param("id") id: string, @Body() dto: PayExpenseDto) {
    return this.expenses.pay(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.expenses.remove(id);
  }
}
