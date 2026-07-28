import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { GoogleAnalyticsService } from "./google-analytics.service";

@Injectable()
export class WebsiteAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ga: GoogleAnalyticsService,
  ) {}

  isConfigured(): boolean {
    return this.ga.isConfigured();
  }

  async latest() {
    const snapshot = await this.prisma.websiteAnalyticsSnapshot.findFirst({
      orderBy: { createdAt: "desc" },
    });
    return { configured: this.ga.isConfigured(), snapshot };
  }

  // Fetches a fresh 30-day window from GA4 and stores it as a new snapshot. Returns
  // `{ configured: false }` rather than throwing when GA4 credentials aren't set — this is the
  // handler for both the nightly cron and the manual "Sync now" button.
  async syncNow() {
    if (!this.ga.isConfigured()) {
      return { configured: false, synced: false };
    }
    const metrics = await this.ga.fetchLast30Days();
    if (!metrics) {
      return { configured: true, synced: false };
    }
    const snapshot = await this.prisma.websiteAnalyticsSnapshot.create({
      data: {
        periodStart: new Date(metrics.periodStart),
        periodEnd: new Date(metrics.periodEnd),
        visitors: metrics.visitors,
        pageViews: metrics.pageViews,
        topPages: metrics.topPages,
        topSources: metrics.topSources,
      },
    });
    return { configured: true, synced: true, snapshot };
  }
}
