import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { DocumentsModule } from "../documents/documents.module";
import { AiModule } from "../ai/ai.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { ReportAccessModule } from "./report-access.module";
import { ReportContentService } from "./report-content.service";
import { ReportsAiService } from "./reports-ai.service";
import { ReportNotifierService } from "./report-notifier.service";
import { ReportsInboxService } from "./reports-inbox.service";
import { ReportSchedulesService } from "./report-schedules.service";
import { ExecutiveOverviewService } from "./executive-overview.service";

@Module({
  imports: [NotificationsModule, DocumentsModule, AiModule, ReportAccessModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ExecutiveOverviewService,
    ReportContentService,
    ReportsAiService,
    ReportNotifierService,
    ReportsInboxService,
    ReportSchedulesService,
  ],
  exports: [ReportNotifierService, ReportsService],
})
export class ReportsModule {}
