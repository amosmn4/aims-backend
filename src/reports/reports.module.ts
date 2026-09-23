import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { DocumentsModule } from "../documents/documents.module";
import { AiModule } from "../ai/ai.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { ReportAccessService } from "./report-access.service";
import { ReportContentService } from "./report-content.service";
import { ReportsAiService } from "./reports-ai.service";
import { ReportNotifierService } from "./report-notifier.service";
import { ReportsInboxService } from "./reports-inbox.service";
import { ReportSchedulesService } from "./report-schedules.service";

@Module({
  imports: [NotificationsModule, DocumentsModule, AiModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportAccessService,
    ReportContentService,
    ReportsAiService,
    ReportNotifierService,
    ReportsInboxService,
    ReportSchedulesService,
  ],
  exports: [ReportNotifierService, ReportsService],
})
export class ReportsModule {}
