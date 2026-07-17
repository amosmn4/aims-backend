import { Module } from "@nestjs/common";
import { TendersController } from "./tenders.controller";
import { TendersService } from "./tenders.service";
import { TenderRequirementTemplatesController } from "./tender-requirement-templates.controller";
import { TenderRequirementTemplatesService } from "./tender-requirement-templates.service";
import { DocumentsModule } from "../../documents/documents.module";

@Module({
  imports: [DocumentsModule],
  controllers: [TendersController, TenderRequirementTemplatesController],
  providers: [TendersService, TenderRequirementTemplatesService],
  exports: [TendersService],
})
export class TendersModule {}
