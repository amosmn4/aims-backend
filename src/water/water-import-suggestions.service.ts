import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { ImportRecord } from "./water-import.types";
import { matchSimilarity, normaliseMatch, type RecordSuggestion } from "./record-suggestions";

@Injectable()
export class WaterImportSuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(data: ImportRecord): Promise<RecordSuggestion[]> {
    if (!["reading", "purchase", "usage", "meter", "customer"].includes(data.kind)) return [];
    const meters = await this.prisma.waterMeter.findMany({
      select: {
        id: true,
        meterNumber: true,
        meterType: true,
        name: true,
        plotNo: true,
        location: true,
        isActive: true,
        customer: { select: { name: true, phone: true } },
        zone: { select: { name: true } },
      },
    });
    const ranked = meters
      .map((meter) => {
        const number = matchSimilarity(data.meterNumber, meter.meterNumber);
        const name = matchSimilarity(
          data.customerName || data.name,
          meter.customer?.name || meter.name,
        );
        const phone =
          normaliseMatch(data.phone) &&
          normaliseMatch(data.phone).slice(-9) === normaliseMatch(meter.customer?.phone).slice(-9)
            ? 1
            : 0;
        const plot =
          data.plotNo && normaliseMatch(data.plotNo) === normaliseMatch(meter.plotNo) ? 1 : 0;
        const zone =
          data.zone &&
          normaliseMatch(data.zone.split("/").at(-1)) === normaliseMatch(meter.zone?.name)
            ? 1
            : 0;
        const evidence = [
          number >= 0.65 ? `meter number similarity ${Math.round(number * 100)}%` : "",
          name >= 0.65 ? `recorded name similarity ${Math.round(name * 100)}%` : "",
          phone ? "same phone" : "",
          plot ? "same plot" : "",
          zone ? "same zone" : "",
        ].filter(Boolean);
        const score =
          Math.max(number, name * 0.92, phone, plot * 0.9) +
          zone * 0.04 +
          Math.min(number, name) * 0.04;
        return { meter, score, evidence, direct: number === 1 || name === 1 || phone === 1 };
      })
      .filter(
        ({ meter, score, evidence }) =>
          score >= 0.65 &&
          evidence.length > 0 &&
          normaliseMatch(meter.meterNumber) !== normaliseMatch(data.meterNumber),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return ranked.map(({ meter, score, evidence, direct }) => ({
      recordId: meter.id,
      label: `${meter.meterNumber} · ${meter.customer?.name || meter.name || meter.meterType}${meter.zone ? ` · ${meter.zone.name}` : ""}${meter.isActive ? "" : " · inactive"}`,
      explanation: `${evidence.join(", ")}. Select only after checking that this is the intended ${meter.meterType} meter.`,
      confidence: direct && score >= 0.94 ? "high" : "possible",
      patch: {
        meterNumber: meter.meterNumber,
        meterType: meter.meterType,
        ...(meter.customer && { customerName: meter.customer.name }),
      },
    }));
  }
}
