import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WebsiteAnalyticsService } from "./website-analytics.service";

// Mirrors NotificationsSweepService's cron pattern — a daily pull rather than a live GA4 call
// per page load, so the dashboard stays fast and GA4 quota isn't spent on every visit.
@Injectable()
export class WebsiteAnalyticsSyncService {
  private readonly logger = new Logger(WebsiteAnalyticsSyncService.name);

  constructor(private readonly websiteAnalytics: WebsiteAnalyticsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async runSync() {
    if (!this.websiteAnalytics.isConfigured()) return;
    const result = await this.websiteAnalytics.syncNow();
    if (!result.synced) {
      this.logger.warn("Website analytics sync ran but produced no snapshot");
    }
  }
}
