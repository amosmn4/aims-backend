import { Module } from "@nestjs/common";
import { AiService } from "./ai.service";
import { AiDataService } from "./ai-data.service";
import { AiAssistantService } from "./ai-assistant.service";
import { AiChatService } from "./ai-chat.service";
import { AiController } from "./ai.controller";
import { DocumentsModule } from "../documents/documents.module";
import { StorageModule } from "../storage/storage.module";
import { ReportAccessModule } from "../reports/report-access.module";

@Module({
  imports: [DocumentsModule, StorageModule, ReportAccessModule],
  controllers: [AiController],
  providers: [AiService, AiDataService, AiAssistantService, AiChatService],
  exports: [AiService, AiAssistantService],
})
export class AiModule {}
