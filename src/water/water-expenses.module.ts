import { Module } from "@nestjs/common";
import { ExpensesModule } from "../finance/expenses/expenses.module";
import { WaterExpensesController } from "./water-expenses.controller";
import { WaterExpensesService } from "./water-expenses.service";

@Module({
  imports: [ExpensesModule],
  controllers: [WaterExpensesController],
  providers: [WaterExpensesService],
  exports: [WaterExpensesService],
})
export class WaterExpensesModule {}
