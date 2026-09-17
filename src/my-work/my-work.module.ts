import { Module } from "@nestjs/common";
import { MyWorkController } from "./my-work.controller";
import { MyWorkService } from "./my-work.service";

@Module({
  controllers: [MyWorkController],
  providers: [MyWorkService],
})
export class MyWorkModule {}
