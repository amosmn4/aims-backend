import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { validateEnv } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { DepartmentsModule } from "./departments/departments.module";
import { OfficesModule } from "./offices/offices.module";
import { ClientsModule } from "./crm/clients/clients.module";
import { ServiceLinesModule } from "./finance/service-lines/service-lines.module";
import { InvoicesModule } from "./finance/invoices/invoices.module";
import { BudgetsModule } from "./finance/budgets/budgets.module";
import { PayrollComplianceModule } from "./finance/payroll-compliance/payroll-compliance.module";
import { FinanceUploadsModule } from "./finance/finance-uploads/finance-uploads.module";
import { FinanceReportsModule } from "./finance/finance-reports/finance-reports.module";
import { ProjectsModule } from "./project-management/projects/projects.module";
import { TasksModule } from "./project-management/tasks/tasks.module";
import { ContractsModule } from "./crm/contracts/contracts.module";
import { TendersModule } from "./crm/tenders/tenders.module";
import { ClientRequestsModule } from "./crm/client-requests/client-requests.module";
import { AuditLogModule } from "./audit-log/audit-log.module";
import { DocumentsModule } from "./documents/documents.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { RecruitmentModule } from "./hr/recruitment/recruitment.module";
import { LeadsModule } from "./marketing/leads/leads.module";
import { WebsiteAnalyticsModule } from "./marketing/website-analytics/website-analytics.module";
import { BlogModule } from "./marketing/blog/blog.module";
import { ItSystemsModule } from "./it/systems/it-systems.module";
import { SearchModule } from "./search/search.module";
import { EngagementsModule } from "./engagements/engagements.module";
import { TicketsModule } from "./it/tickets/tickets.module";
import { HrmsLicensesModule } from "./it/hrms-licenses/hrms-licenses.module";
import { InventoryModule } from "./it/inventory/inventory.module";
import { CampaignsModule } from "./marketing/campaigns/campaigns.module";
import { CalendarModule } from "./calendar/calendar.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    // General ceiling for every route; login/set-password apply a stricter @Throttle() override.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    DepartmentsModule,
    OfficesModule,
    ClientsModule,
    ServiceLinesModule,
    InvoicesModule,
    BudgetsModule,
    PayrollComplianceModule,
    FinanceUploadsModule,
    FinanceReportsModule,
    ProjectsModule,
    TasksModule,
    ContractsModule,
    TendersModule,
    ClientRequestsModule,
    AuditLogModule,
    DocumentsModule,
    NotificationsModule,
    RecruitmentModule,
    LeadsModule,
    WebsiteAnalyticsModule,
    BlogModule,
    ItSystemsModule,
    SearchModule,
    EngagementsModule,
    TicketsModule,
    HrmsLicensesModule,
    InventoryModule,
    CampaignsModule,
    CalendarModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
