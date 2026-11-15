import { ForbiddenException, Injectable } from "@nestjs/common";
import { AiDataService } from "../../ai/ai-data.service";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Injectable()
export class OpsWaterDocuments {
  async getFileForDownload(): Promise<never> {
    throw new ForbiddenException("Documents are outside the Water module.");
  }
  async findOne(): Promise<never> {
    throw new ForbiddenException("Documents are outside the Water module.");
  }
}

@Injectable()
export class OpsWaterDataService extends AiDataService {
  override catalog() {
    const rows = super
      .catalog()
      .filter((row) => row.model.startsWith("Water") || row.model === "Expense");
    const allowed = new Set(rows.map((row) => row.model));
    return rows.map((row) => ({
      ...row,
      links: row.links.filter((link) => allowed.has(link.model)),
    }));
  }

  override async query(input: unknown, user: AuthenticatedUser) {
    const model = input && typeof input === "object" && "model" in input ? input.model : null;
    if (typeof model !== "string" || !this.catalog().some((row) => row.model === model))
      throw new ForbiddenException("Only Water records are available in this assistant.");
    if (model !== "Expense") return super.query(input, user);
    const query = input as Record<string, unknown>;
    const filters = typeof query.filters === "string" ? JSON.parse(query.filters) : {};
    return super.query(
      {
        ...query,
        filters: JSON.stringify({
          AND: [filters, { waterCategory: { not: null }, currencyCode: "KES" }],
        }),
      },
      { ...user, roles: ["water", "finance"] },
    );
  }

  override async overview(user: AuthenticatedUser, requested: string[] = []) {
    const allowed = this.catalog().map((row) => row.model);
    if (requested.some((model) => !allowed.includes(model)))
      throw new ForbiddenException("Only Water records are available in this assistant.");
    return super.overview(user, requested.length ? requested : allowed);
  }

  override async document(): Promise<never> {
    throw new ForbiddenException("Documents are outside the Water module.");
  }
}
