import { Module } from "@nestjs/common";
import { WebsiteAnalyticsController } from "./website-analytics.controller";
import { WebsiteAnalyticsService } from "./website-analytics.service";
import { WebsiteAnalyticsSyncService } from "./website-analytics-sync.service";
import { GoogleAnalyticsService } from "./google-analytics.service";

@Module({
  controllers: [WebsiteAnalyticsController],
  providers: [WebsiteAnalyticsService, WebsiteAnalyticsSyncService, GoogleAnalyticsService],
  exports: [WebsiteAnalyticsService],
})
export class WebsiteAnalyticsModule {}
