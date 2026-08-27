import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

export interface GaMetrics {
  periodStart: string;
  periodEnd: string;
  visitors: number;
  pageViews: number;
  topPages: { path: string; views: number }[];
  topSources: { source: string; sessions: number }[];
}

const WINDOW_DAYS = 30;

// Thin wrapper around GA4's Data API. Both env vars are optional (see env.validation.ts) so the
// app boots fine without a GA4 property set up yet — isConfigured()/fetchLast30Days() give
// callers a clear "not connected" signal instead of throwing.
@Injectable()
export class GoogleAnalyticsService {
  private readonly logger = new Logger(GoogleAnalyticsService.name);
  private readonly client: BetaAnalyticsDataClient | null = null;
  private readonly propertyId: string | null = null;

  constructor(config: ConfigService) {
    const propertyId = config.get<string>("GA4_PROPERTY_ID");
    const keyJson = config.get<string>("GA4_SERVICE_ACCOUNT_KEY_JSON");
    if (!propertyId || !keyJson) return;
    try {
      const credentials = JSON.parse(keyJson);
      this.client = new BetaAnalyticsDataClient({ credentials });
      this.propertyId = propertyId;
    } catch {
      this.logger.error("GA4_SERVICE_ACCOUNT_KEY_JSON is not valid JSON — Website Analytics will stay disconnected");
    }
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  async fetchLast30Days(): Promise<GaMetrics | null> {
    if (!this.client || !this.propertyId) return null;
    const property = `properties/${this.propertyId}`;
    const dateRanges = [{ startDate: `${WINDOW_DAYS}daysAgo`, endDate: "today" }];

    try {
      const [summary] = await this.client.runReport({
        property,
        dateRanges,
        metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      });
      const visitors = Number(summary.rows?.[0]?.metricValues?.[0]?.value ?? 0);
      const pageViews = Number(summary.rows?.[0]?.metricValues?.[1]?.value ?? 0);

      const [pagesReport] = await this.client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      });
      const topPages = (pagesReport.rows ?? []).map((r) => ({
        path: r.dimensionValues?.[0]?.value ?? "",
        views: Number(r.metricValues?.[0]?.value ?? 0),
      }));

      const [sourcesReport] = await this.client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      });
      const topSources = (sourcesReport.rows ?? []).map((r) => ({
        source: r.dimensionValues?.[0]?.value ?? "",
        sessions: Number(r.metricValues?.[0]?.value ?? 0),
      }));

      const now = new Date();
      const start = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
      return {
        periodStart: start.toISOString().slice(0, 10),
        periodEnd: now.toISOString().slice(0, 10),
        visitors,
        pageViews,
        topPages,
        topSources,
      };
    } catch (err) {
      this.logger.error("GA4 report fetch failed", err instanceof Error ? err.stack : undefined);
      return null;
    }
  }
}
