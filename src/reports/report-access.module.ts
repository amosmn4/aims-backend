import { Module } from "@nestjs/common";
import { ReportAccessService } from "./report-access.service";

@Module({ providers: [ReportAccessService], exports: [ReportAccessService] })
export class ReportAccessModule {}
