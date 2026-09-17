import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { DocumentsModule } from "../documents/documents.module";
import { DepartmentReportsController } from "./department-reports.controller";
import { DepartmentReportsService } from "./department-reports.service";
import { ReportNotifierService } from "./report-notifier.service";
import { ReportsInboxService } from "./reports-inbox.service";
import { ReportSchedulesService } from "./report-schedules.service";
import { SuggestedFiguresService } from "./suggested-figures.service";

@Module({
  imports: [NotificationsModule, DocumentsModule],
  controllers: [DepartmentReportsController],
  providers: [
    DepartmentReportsService,
    ReportNotifierService,
    ReportsInboxService,
    ReportSchedulesService,
    SuggestedFiguresService,
  ],
  exports: [ReportNotifierService],
})
export class ReportsModule {}
