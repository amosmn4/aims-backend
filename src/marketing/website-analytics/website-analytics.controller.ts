import { Controller, Get, Post } from "@nestjs/common";
import { WebsiteAnalyticsService } from "./website-analytics.service";
import { Roles } from "../../auth/decorators/roles.decorator";

@Controller("website-analytics")
export class WebsiteAnalyticsController {
  constructor(private readonly websiteAnalytics: WebsiteAnalyticsService) {}

  @Get("latest")
  @Roles()
  latest() {
    return this.websiteAnalytics.latest();
  }

  // Manual trigger, mirrors notifications' sweep-now — useful for demos/testing without
  // waiting for the nightly cron. Returns a clean "not configured" result rather than a 500
  // when GA4 credentials aren't set.
  @Post("sync-now")
  @Roles("marketing")
  syncNow() {
    return this.websiteAnalytics.syncNow();
  }
}
